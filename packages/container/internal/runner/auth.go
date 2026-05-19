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
	"net/http"
	"net/http/httputil"
	"strconv"
	"strings"
	"time"
)

func (r *Runner) RunAuthSequence(ctx context.Context) error {
	cfg := r.config
	if len(cfg.AuthSequence) == 0 {
		return nil
	}

	fmt.Printf("Running authentication sequence (%d steps)...\n", len(cfg.AuthSequence))

	reqCtx, reqCancel := context.WithTimeout(ctx, 30*time.Second)
	defer reqCancel()

	for i, step := range cfg.AuthSequence {
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
				return fmt.Errorf("auth step %d: failed to marshal body: %w", i+1, err)
			}
			bodyReader = bytes.NewReader(b)
		}

		req, err := http.NewRequestWithContext(reqCtx, step.Method, fullURL, bodyReader)
		if err != nil {
			return fmt.Errorf("auth step %d: failed to create request: %w", i+1, err)
		}

		if step.Body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		
		r.configMu.RLock()
		for k, v := range step.Headers {
			req.Header.Set(k, r.subVarsLocked(v))
		}
		// Apply currently collected headers and cookies
		if len(cfg.GlobalHeaders) > 0 {
			for k, v := range cfg.GlobalHeaders {
				req.Header.Set(k, v)
			}
		}
		if len(cfg.Cookies) > 0 {
			for k, v := range cfg.Cookies {
				req.AddCookie(&http.Cookie{Name: k, Value: v})
			}
		}
		r.configMu.RUnlock()

		if cfg.Settings.Debug {
			dump, _ := httputil.DumpRequestOut(req, true)
			fmt.Printf("\n--- [DEBUG] Auth Request ---\n%s\n----------------------------\n", string(dump))
		}

		resp, err := r.client.Do(req)
		if err != nil {
			return fmt.Errorf("auth step %d: request failed: %w", i+1, err)
		}

		if cfg.Settings.Debug {
			dump, _ := httputil.DumpResponse(resp, false)
			fmt.Printf("\n--- [DEBUG] Auth Response ---\n%s\n-----------------------------\n", string(dump))
		}

		fmt.Printf("  Step %d: %s %s -> %d\n", i+1, step.Method, fullURL, resp.StatusCode)

		body, err := io.ReadAll(io.LimitReader(resp.Body, 1*1024*1024))
		io.Copy(io.Discard, resp.Body) // Ensure body is fully drained for connection reuse
		resp.Body.Close()

		if err != nil {
			return fmt.Errorf("auth step %d: failed to read response: %w", i+1, err)
		}

		if resp.StatusCode >= 400 {
			errBody := string(body)
			if len(errBody) > 1024 {
				errBody = errBody[:1024]
			}
			return fmt.Errorf("auth step %d failed with status %d: %s", i+1, resp.StatusCode, errBody)
		}

		// Collect cookies
		for _, cookie := range resp.Cookies() {
			shouldSave := true
			if len(step.ExtractCookies) > 0 {
				shouldSave = false
				for _, name := range step.ExtractCookies {
					if name == cookie.Name {
						shouldSave = true
						break
					}
				}
			}

			if shouldSave {
				r.configMu.Lock()
				if cfg.Cookies == nil {
					cfg.Cookies = make(map[string]string)
				}
				cfg.Cookies[cookie.Name] = cookie.Value
				r.configMu.Unlock()
				fmt.Printf("    [Auth] Saved cookie: %s\n", cookie.Name)
			}
		}

		// Extract JSON fields
		if len(step.ExtractJSON) > 0 || len(step.ExtractVariables) > 0 {
			var parsed map[string]any
			if err := json.Unmarshal(body, &parsed); err != nil {
				if len(step.ExtractJSON) > 0 || len(step.ExtractVariables) > 0 {
					return fmt.Errorf("auth step %d: failed to parse JSON response for value extraction: %w", i+1, err)
				}
				fmt.Printf("    \033[33m[Auth] Warning: Failed to parse response JSON: %v\033[0m\n", err)
			} else {
				for jsonKey, headerName := range step.ExtractJSON {
					val := extractJSONPath(parsed, jsonKey)
					if val != nil {
						r.configMu.Lock()
						if cfg.GlobalHeaders == nil {
							cfg.GlobalHeaders = make(map[string]string)
						}
						// If headerName is "Authorization" and doesn't have Bearer,
						// we might want to be smart, but let's keep it literal for now.
						strVal := fmt.Sprintf("%v", val)
						cfg.GlobalHeaders[headerName] = strVal
						r.configMu.Unlock()
						fmt.Printf("    [Auth] Extracted %s -> Header %s\n", jsonKey, headerName)
					}
				}
				varsUpdated := false
				for jsonKey, varName := range step.ExtractVariables {
					val := extractJSONPath(parsed, jsonKey)
					if val != nil {
						r.configMu.Lock()
						if cfg.Variables == nil {
							cfg.Variables = make(map[string]any)
						}
						cfg.Variables[varName] = val
						r.configMu.Unlock()
						fmt.Printf("    [Auth] Extracted %s -> Variable {{%s}}\n", jsonKey, varName)
						varsUpdated = true
					}
				}
				if varsUpdated {
					r.updateReplacer()
				}
			}
		}
	}

	fmt.Println("Authentication sequence complete.")
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
