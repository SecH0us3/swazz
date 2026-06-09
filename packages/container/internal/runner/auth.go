// auth.go: Handles authentication sequences and variable management.
// It provides functionality to run multi-step authentication flows, substitute
// variables in requests, and extract values from responses.

package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httputil"
	"slices"
	"strconv"
	"strings"
	"time"

	"swazz-engine/internal/swagger"
)

func (r *Runner) ExecuteAuthSequence(ctx context.Context, sequence []swagger.AuthStep, initialHeaders map[string]string, initialCookies map[string]string) (map[string]string, map[string]string, error) {
	cfg := r.config
	headers := make(map[string]string)
	cookies := make(map[string]string)
	maps.Copy(headers, initialHeaders)
	maps.Copy(cookies, initialCookies)

	if len(sequence) == 0 {
		return headers, cookies, nil
	}

	fmt.Printf("Running authentication sequence (%d steps)...\n", len(sequence))

	reqCtx, reqCancel := context.WithTimeout(ctx, 30*time.Second)
	defer reqCancel()

	for i, step := range sequence {

		if len(step.SetVariables) > 0 {
			cache := make(map[string]string) // кэш вызовов функций на этот шаг

			r.configMu.Lock()
			if cfg.Variables == nil {
				cfg.Variables = make(map[string]any)
			}
			r.configMu.Unlock()

			for varName, expr := range step.SetVariables {
				var result string
				var err error

				expr = strings.TrimSpace(expr)
				if looksLikeFuncCall(expr) {
					node, parseErr := parseExpression(expr)
					if parseErr != nil {
						return nil, nil, fmt.Errorf("auth step %d: set_variables[%q]: parse error: %w",
							i+1, varName, parseErr)
					}
					result, err = r.evalExpr(node, cache)
					if err != nil {
						return nil, nil, fmt.Errorf("auth step %d: set_variables[%q]: eval error: %w",
							i+1, varName, err)
					}
				} else {
					r.configMu.RLock()
					result = r.subVarsLocked(expr)
					r.configMu.RUnlock()
				}

				r.configMu.Lock()
				cfg.Variables[varName] = result
				r.configMu.Unlock()

				fmt.Printf("    [Auth] set_variables: {{%s}} = %q\n", varName, result)
			}

			r.updateReplacer()
		}

		fullURL := r.subVars(step.URL)
		if !strings.HasPrefix(fullURL, "http://") && !strings.HasPrefix(fullURL, "https://") {
			fullURL = strings.TrimRight(cfg.BaseURL, "/") + "/" + strings.TrimLeft(fullURL, "/")
		}

		var bodyReader io.Reader
		if step.Body != nil {
			r.configMu.RLock()
			subBody := r.substituteInObject(step.Body)
			r.configMu.RUnlock()
			b, err := json.Marshal(subBody)
			if err != nil {
				return nil, nil, fmt.Errorf("auth step %d: failed to marshal body: %w", i+1, err)
			}
			bodyReader = bytes.NewReader(b)
		}

		req, err := http.NewRequestWithContext(reqCtx, step.Method, fullURL, bodyReader)
		if err != nil {
			return nil, nil, fmt.Errorf("auth step %d: failed to create request: %w", i+1, err)
		}

		if step.Body != nil {
			req.Header.Set("Content-Type", "application/json")
		}

		r.configMu.RLock()
		for k, v := range step.Headers {
			req.Header.Set(k, r.subVarsLocked(v))
		}
		// Apply accumulated headers and cookies for this sequence
		if len(headers) > 0 {
			for k, v := range headers {
				req.Header.Set(k, v)
			}
		}
		if len(cookies) > 0 {
			for k, v := range cookies {
				req.AddCookie(&http.Cookie{Name: k, Value: v}) // #nosec G124
			}
		}
		r.configMu.RUnlock()

		if cfg.Settings.Debug {
			// codeql[go/request-forgery] false positive: fuzzer auth
			dump, _ := httputil.DumpRequestOut(req, true) //lgtm[go/request-forgery]
			fmt.Printf("--- [DEBUG] Auth Request ---\n%s\n----------------------------\n", string(dump))
		}

		// codeql[go/request-forgery] false positive: fuzzer auth process needs to request user-specified URLs
		resp, err := r.client.Do(req)
		if err != nil {
			return nil, nil, fmt.Errorf("auth step %d: request failed: %w", i+1, err)
		}

		if cfg.Settings.Debug {
			// codeql[go/request-forgery] false positive: fuzzer auth
			dump, _ := httputil.DumpResponse(resp, false) //lgtm[go/request-forgery]
			fmt.Printf("\n--- [DEBUG] Auth Response ---\n%s\n-----------------------------\n", string(dump))
		}

		fmt.Printf("  Step %d: %s %s -> %d\n", i+1, step.Method, fullURL, resp.StatusCode)

		body, err := io.ReadAll(io.LimitReader(resp.Body, 1*1024*1024))
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()

		if err != nil {
			return nil, nil, fmt.Errorf("auth step %d: failed to read response: %w", i+1, err)
		}

		if resp.StatusCode >= 400 {
			errBody := string(body)
			if len(errBody) > 1024 {
				errBody = errBody[:1024]
			}
			return nil, nil, fmt.Errorf("auth step %d failed with status %d: %s", i+1, resp.StatusCode, errBody)
		}

		// Collect cookies
		for _, cookie := range resp.Cookies() {
			shouldSave := true
			if len(step.ExtractCookies) > 0 {
				shouldSave = slices.Contains(step.ExtractCookies, cookie.Name)
			}

			if shouldSave {
				cookies[cookie.Name] = cookie.Value
				fmt.Printf("    [Auth] Saved cookie: %s\n", cookie.Name)
			}
		}

		// Extract JSON fields & Variables
		if len(step.ExtractJSON) > 0 || len(step.ExtractVariables) > 0 {
			var parsed map[string]any
			if err := json.Unmarshal(body, &parsed); err != nil {
				return nil, nil, fmt.Errorf("auth step %d: failed to parse JSON response for value extraction: %w", i+1, err)
			}

			r.configMu.Lock()
			if cfg.Variables == nil {
				cfg.Variables = make(map[string]any)
			}

			for jsonKey, headerName := range step.ExtractJSON {
				val := extractJSONPath(parsed, jsonKey)
				if val != nil {
					strVal := fmt.Sprintf("%v", val)
					headers[headerName] = strVal
					fmt.Printf("    [Auth] Extracted %s -> Header %s\n", jsonKey, headerName)
				}
			}

			varsUpdated := false
			for jsonKey, varName := range step.ExtractVariables {
				val := extractJSONPath(parsed, jsonKey)
				if val != nil {
					cfg.Variables[varName] = val
					fmt.Printf("    [Auth] Extracted %s -> Variable {{%s}}\n", jsonKey, varName)
					varsUpdated = true
				}
			}
			r.configMu.Unlock()

			if varsUpdated {
				r.updateReplacer()
			}
		}
	}

	fmt.Println("Authentication sequence complete.")
	return headers, cookies, nil
}

func (r *Runner) RunAuthSequence(ctx context.Context) error {
	if len(r.config.AuthSequence) == 0 {
		return nil
	}
	headers, cookies, err := r.ExecuteAuthSequence(ctx, r.config.AuthSequence, r.config.GlobalHeaders, r.config.Cookies)
	if err != nil {
		return err
	}
	r.configMu.Lock()
	r.config.GlobalHeaders = headers
	r.config.Cookies = cookies
	r.configMu.Unlock()
	return nil
}

// extractJSONPath allows retrieving a nested value from a JSON map using dot notation (e.g., "data.token" or "data.users[0].id").
func extractJSONPath(data map[string]any, path string) any {
	parts := strings.Split(path, ".")
	var current any = data
	for i, part := range parts {
		var key = part
		var arrIdx = -1
		if start := strings.IndexByte(part, '['); start >= 0 {
			if end := strings.IndexByte(part, ']'); end > start {
				if idx, err := strconv.Atoi(part[start+1 : end]); err == nil {
					arrIdx = idx
					key = part[:start]
				}
			}
		}

		if m, ok := current.(map[string]any); ok {
			current = m[key]
		} else {
			return nil
		}

		if current != nil && arrIdx >= 0 {
			if arr, ok := current.([]any); ok && arrIdx < len(arr) {
				current = arr[arrIdx]
			} else {
				return nil
			}
		}

		if current == nil {
			return nil
		}
		if i == len(parts)-1 {
			return current
		}
	}
	return nil
}

// substituteInObject deeply substitutes string variables inside maps/slices.
// Must be called while holding configMu.RLock.
func (r *Runner) substituteInObject(v any) any {
	switch val := v.(type) {
	case string:
		return r.subVarsLocked(val)
	case map[string]any:
		res := make(map[string]any)
		for k, v := range val {
			res[k] = r.substituteInObject(v)
		}
		return res
	case []any:
		res := make([]any, len(val))
		for i, v := range val {
			res[i] = r.substituteInObject(v)
		}
		return res
	default:
		return v
	}
}

// exprNode — узел AST выражения из set_variables.
// Если Args == nil — это ссылка на переменную (varRef).
// Если Args != nil (включая пустой срез) — вызов функции (funcCall).
func (r *Runner) isUsingActiveSession(reqHeaders, reqCookies map[string]string) bool {
	r.configMu.RLock()
	defer r.configMu.RUnlock()

	// If no auth headers or cookies are configured, we assume it's always using active session
	if len(r.config.Settings.AuthHeaders) == 0 && len(r.config.Settings.AuthCookies) == 0 {
		return true
	}

	// Check headers
	for _, hName := range r.config.Settings.AuthHeaders {
		cfgVal := r.config.GlobalHeaders[hName]
		reqVal := reqHeaders[hName]
		if cfgVal != "" && reqVal != "" {
			return true
		}
	}

	// Check cookies
	for _, cName := range r.config.Settings.AuthCookies {
		cfgVal := r.config.Cookies[cName]
		reqVal := reqCookies[cName]
		if cfgVal != "" && reqVal != "" {
			return true
		}
	}

	return false
}

func (r *Runner) isSessionExpired(resp *http.Response, bodyBytes []byte, reqHeaders, reqCookies map[string]string, profile swagger.FuzzingProfile) bool {
	if resp == nil {
		return false
	}

	// Skip session expiration checks for BOLA/IDOR scans to preserve expected vulnerability findings
	if profile == swagger.FuzzingProfile("BOLA") {
		return false
	}

	// 1. HTTP 401 or 403
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return r.isUsingActiveSession(reqHeaders, reqCookies)
	}

	// 2. Redirect to login page in Location header or final URL
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		loc := resp.Header.Get("Location")
		if loc != "" {
			locLower := strings.ToLower(loc)
			if strings.Contains(locLower, "/login") || strings.Contains(locLower, "/signin") || strings.Contains(locLower, "/auth") {
				return r.isUsingActiveSession(reqHeaders, reqCookies)
			}
		}
	}
	if resp.Request != nil && resp.Request.URL != nil {
		path := strings.ToLower(resp.Request.URL.Path)
		if strings.Contains(path, "/login") || strings.Contains(path, "/signin") || strings.Contains(path, "/auth") {
			return r.isUsingActiveSession(reqHeaders, reqCookies)
		}
	}

	// 3. Response body contains typical login form indicators
	if len(bodyBytes) > 0 {
		bodyStr := strings.ToLower(string(bodyBytes))
		if (strings.Contains(bodyStr, "login-form") || strings.Contains(bodyStr, "sign in") || strings.Contains(bodyStr, "please sign in")) &&
			strings.Contains(bodyStr, "<form") &&
			(strings.Contains(bodyStr, "password") || strings.Contains(bodyStr, "username") || strings.Contains(bodyStr, "email")) {
			return r.isUsingActiveSession(reqHeaders, reqCookies)
		}
	}
	return false
}

func (r *Runner) extractAndSaveCSRFToken(resp *http.Response, bodyBytes []byte) {
	if resp == nil {
		return
	}

	var token string

	// 1. Check cookies first
	for _, cookie := range resp.Cookies() {
		name := strings.ToLower(cookie.Name)
		if strings.Contains(name, "csrf") || strings.Contains(name, "xsrf") {
			token = cookie.Value
			break
		}
	}

	// 2. Check HTML body meta tags or inputs
	if token == "" && len(bodyBytes) > 0 {
		if matches := csrfMetaRegex.FindSubmatch(bodyBytes); len(matches) > 0 {
			for i := 1; i < len(matches); i++ {
				if len(matches[i]) > 0 {
					token = string(matches[i])
					break
				}
			}
		}
		if token == "" {
			if matches := csrfInputRegex.FindSubmatch(bodyBytes); len(matches) > 0 {
				for i := 1; i < len(matches); i++ {
					if len(matches[i]) > 0 {
						token = string(matches[i])
						break
					}
				}
			}
		}
	}

	if token != "" {
		r.csrfMu.Lock()
		r.activeCSRFToken = token
		r.csrfMu.Unlock()
	}
}

func (r *Runner) MaybeReauthenticate(ctx context.Context, reqHeaders, reqCookies map[string]string) (map[string]string, map[string]string, bool, error) {
	r.reauthMu.Lock()
	defer r.reauthMu.Unlock()

	// Double check: check if the session has already been refreshed since this request started/failed.
	isFresh := false
	r.configMu.RLock()
	for _, hName := range r.config.Settings.AuthHeaders {
		if r.config.GlobalHeaders[hName] != reqHeaders[hName] {
			isFresh = true
			break
		}
	}
	for _, cName := range r.config.Settings.AuthCookies {
		if r.config.Cookies[cName] != reqCookies[cName] {
			isFresh = true
			break
		}
	}
	if len(r.config.Settings.AuthHeaders) == 0 && len(r.config.Settings.AuthCookies) == 0 {
		for k, v := range r.config.GlobalHeaders {
			if reqHeaders[k] != v {
				isFresh = true
				break
			}
		}
		for k, v := range r.config.Cookies {
			if reqCookies[k] != v {
				isFresh = true
				break
			}
		}
	}

	if isFresh {
		headersCopy := maps.Clone(r.config.GlobalHeaders)
		cookiesCopy := maps.Clone(r.config.Cookies)
		r.configMu.RUnlock()
		return headersCopy, cookiesCopy, true, nil
	}
	r.configMu.RUnlock()

	fmt.Println("[Session] Session expired. Initiating automatic re-authentication...")
	if err := r.RunAuthSequence(ctx); err != nil {
		return nil, nil, false, fmt.Errorf("re-authentication failed: %w", err)
	}

	r.configMu.RLock()
	defer r.configMu.RUnlock()
	return maps.Clone(r.config.GlobalHeaders), maps.Clone(r.config.Cookies), true, nil
}
