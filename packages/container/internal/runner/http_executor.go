package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"math/rand"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/swagger"
	"time"
	tidwallgjson "github.com/tidwall/gjson"

	"github.com/google/uuid"
)

// sensitiveKeyPatterns contains patterns for keys that may contain sensitive data
var sensitiveKeyPatterns = []string{
	"password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
	"api-key", "auth", "authorization", "bearer", "credential", "private",
	"access", "key", "session", "cookie", "csrf", "xsrf",
}

// maskSensitiveArgs masks potentially sensitive values in arguments map
func maskSensitiveArgs(args map[string]any) map[string]any {
	if args == nil {
		return nil
	}
	masked := make(map[string]any, len(args))
	for k, v := range args {
		keyLower := strings.ToLower(k)
		isSensitive := false
		for _, pattern := range sensitiveKeyPatterns {
			if strings.Contains(keyLower, pattern) {
				isSensitive = true
				break
			}
		}
		if isSensitive {
			masked[k] = "[REDACTED]"
		} else if m, ok := v.(map[string]any); ok {
			masked[k] = maskSensitiveArgs(m)
		} else {
			masked[k] = v
		}
	}
	return masked
}

var (
	proxyCounter uint32
	userAgents   = []string{
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5.2 Safari/605.1.15",
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
		"Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1",
	}
)

func getRandomUserAgent() string {
	return userAgents[rand.Intn(len(userAgents))]
}

func getNextProxy(proxies []string) string {
	if len(proxies) == 0 {
		return ""
	}
	idx := atomic.AddUint32(&proxyCounter, 1)
	return proxies[idx%uint32(len(proxies))]
}

func (r *Runner) executeRequest(
	ctx context.Context,
	baseURL, resolvedPath, originalPath, method string,
	headers, cookies map[string]string,
	payload any,
	profile swagger.FuzzingProfile,
	queryParams map[string]any,
	generatedHeaders map[string]string,
	contentType string,
) *swagger.FuzzResult {
	if strings.HasPrefix(originalPath, "mcp://tool/") {
		return r.executeMCPRequest(ctx, originalPath, payload, profile)
	}

	// Merge headers: generatedHeaders < global headers
	isBody := !isNoBodyMethod(method)
	mergedHeaders := make(map[string]string)
	for k, v := range generatedHeaders {
		mergedHeaders[k] = r.subStateVars(v)
	}

	r.configMu.RLock()
	for k, v := range headers {
		// Apply variable substitution to global headers too
		mergedHeaders[k] = r.subStateVars(r.subVarsLocked(v))
	}

	hasUA := false
	for k := range mergedHeaders {
		if strings.EqualFold(k, "user-agent") {
			hasUA = true
			break
		}
	}
	
	randomizeUA := r.config.Settings.RandomizeUserAgent
	proxyList := r.config.Settings.ProxyList
	enableAdaptiveRateLimit := r.config.Settings.EnableAdaptiveRateLimit

	if !hasUA {
		if randomizeUA {
			mergedHeaders["User-Agent"] = getRandomUserAgent()
		} else {
			mergedHeaders["User-Agent"] = "Swazz/1.0 (+https://github.com/SecH0us3/swazz)"
		}
	}

	effectiveCT := contentType
	if effectiveCT == "" {
		effectiveCT = "application/json"
	}
	hasContentType := false
	payload = r.subStateVarsAny(payload)
	for k := range mergedHeaders {
		if strings.EqualFold(k, "content-type") {
			hasContentType = true
			break
		}
	}
	if isBody && payload != nil && !hasContentType {
		mergedHeaders["Content-Type"] = effectiveCT
	}

	base, err := url.Parse(strings.TrimRight(baseURL, "/"))
	var rawURL string
	if err == nil {
		rawURL = base.JoinPath(resolvedPath).String()
	} else {
		rawURL = strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(resolvedPath, "/")
	}
	rawURL = r.subStateVars(r.subVarsLocked(rawURL))

	if len(queryParams) > 0 {
		if parsedURL, err := url.Parse(rawURL); err == nil {
			query := parsedURL.Query()
			for k, v := range queryParams {
				query.Set(k, r.subStateVars(fmt.Sprintf("%v", v)))
			}
			parsedURL.RawQuery = query.Encode()
			rawURL = parsedURL.String()
		}
	}

	timeoutMs := r.config.Settings.TimeoutMs
	r.configMu.RUnlock()
	if timeoutMs <= 0 {
		timeoutMs = 10000
	}

	for attempt := 0; ; attempt++ {
		payloadSize := 0
		reqCtx, reqCancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)

		// Clone cookies on the first attempt to prevent concurrent map read/write races
		if attempt == 0 {
			r.configMu.RLock()
			cookies = maps.Clone(cookies)
			r.configMu.RUnlock()
		}

		// Inject CSRF token if active and request is unsafe (POST, PUT, DELETE, PATCH)
		r.csrfMu.RLock()
		activeCSRF := r.activeCSRFToken
		r.csrfMu.RUnlock()

		if activeCSRF != "" && (method == "POST" || method == "PUT" || method == "DELETE" || method == "PATCH") {
			// 1. Inject into mergedHeaders
			hasCSRFHeader := false
			for k := range mergedHeaders {
				kLower := strings.ToLower(k)
				if strings.Contains(kLower, "csrf") || strings.Contains(kLower, "xsrf") {
					mergedHeaders[k] = activeCSRF
					hasCSRFHeader = true
				}
			}
			if !hasCSRFHeader {
				mergedHeaders["X-CSRF-Token"] = activeCSRF
			}

			// 2. Inject into payload body if payload is map[string]any
			if m, ok := payload.(map[string]any); ok {
				// Make a copy of map to avoid mutating the shared configuration definition
				mCopy := make(map[string]any)
				for k, v := range m {
					mCopy[k] = v
				}
				for k := range mCopy {
					kLower := strings.ToLower(k)
					if strings.Contains(kLower, "csrf") || strings.Contains(kLower, "xsrf") {
						mCopy[k] = activeCSRF
					}
				}
				payload = mCopy
			}
		}

		var bodyReader io.Reader
		if isBody && payload != nil {
			if strings.Contains(effectiveCT, "x-www-form-urlencoded") {
				if m, ok := payload.(map[string]any); ok {
					vals := url.Values{}
					for k, v := range m {
						vals.Set(k, fmt.Sprintf("%v", v))
					}
					bodyReader = strings.NewReader(vals.Encode())
					payloadSize = len(vals.Encode())
				}
			}
			if bodyReader == nil && strings.Contains(effectiveCT, "xml") {
				if m, ok := payload.(map[string]any); ok {
					xmlContent, _ := generator.ToXML(m, "request")
					soapBody, _ := generator.WrapInSOAP(xmlContent)
					bodyReader = strings.NewReader(soapBody)
					payloadSize = len(soapBody)
				}
			}

			if bodyReader == nil {
				b, _ := json.Marshal(payload)
				bodyReader = strings.NewReader(string(b))
				payloadSize = len(b)
			}
		}

		if len(cookies) > 0 {
			var cookieParts []string
			for k, v := range cookies {
				cookieParts = append(cookieParts, fmt.Sprintf("%s=%s", k, v))
			}
			mergedHeaders["Cookie"] = strings.Join(cookieParts, "; ")
		}

		req, err := http.NewRequestWithContext(reqCtx, method, rawURL, bodyReader)
		if err != nil {
			reqCancel()
			return &swagger.FuzzResult{
				ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
				Method: method, Profile: profile, Status: 0, Payload: payload, PayloadSize: payloadSize,
				Error: err.Error(), Timestamp: time.Now().UnixMilli(), Retries: attempt,
				RequestHeaders: mergedHeaders,
			}
		}

		for k, v := range mergedHeaders {
			if strings.EqualFold(k, "Host") {
				req.Host = v
			} else if !strings.EqualFold(k, "Cookie") || len(cookies) == 0 {
				req.Header.Set(k, v)
			}
		}
		if len(cookies) > 0 {
			for k, v := range cookies {
				req.AddCookie(&http.Cookie{Name: k, Value: v}) // #nosec G124
			}
		}

		var reqDump []byte
		var dumpErr error
		if logger.IsDebugEnabled() || r.config.Settings.Debug || profile == swagger.ProfileMalicious {
			reqDump, dumpErr = httputil.DumpRequestOut(req, true)
		}

		if (logger.IsDebugEnabled() || r.config.Settings.Debug) && dumpErr == nil {
			r.logDebug("\n--- Fuzz Request ---\n%s\n--------------------", string(reqDump))
		}

		// Look for OOB payloads to register the actual request details
		if profile == swagger.ProfileMalicious {
			if dumpErr == nil {
				reqStr := string(reqDump)
				matches := uuidRegex.FindAllString(reqStr, -1)
				if len(matches) > 0 {
					reqLog := &swagger.RequestLog{
						Method:       method,
						URL:          rawURL,
						Headers:      mergedHeaders,
						OriginalPath: originalPath,
						ResolvedPath: req.URL.RequestURI(),
					}
					var body string
					if parts := strings.SplitN(reqStr, "\r\n\r\n", 2); len(parts) == 2 {
						body = parts[1]
					} else if parts := strings.SplitN(reqStr, "\n\n", 2); len(parts) == 2 {
						body = parts[1]
					}
					reqLog.Body = body

					for _, uuidMatch := range matches {
						oob.GlobalStore.UpdateRequest(uuidMatch, reqLog)
					}
				}
			}
		}

		var clientToUse = r.client
		proxyStr := getNextProxy(proxyList)
		var customTransport *http.Transport
		if proxyStr != "" {
			if proxyURL, err := url.Parse(proxyStr); err == nil {
				var baseTransport *http.Transport
				if r.client.Transport != nil {
					if t, ok := r.client.Transport.(*http.Transport); ok {
						baseTransport = t
					}
				} else {
					if t, ok := http.DefaultTransport.(*http.Transport); ok {
						baseTransport = t
					}
				}
				if baseTransport != nil {
					customTransport = baseTransport.Clone()
					customTransport.Proxy = http.ProxyURL(proxyURL)
					clientToUse = &http.Client{
						Transport:     customTransport,
						CheckRedirect: r.client.CheckRedirect,
						Timeout:       r.client.Timeout,
					}
				}
			}
		}
		if customTransport != nil {
			defer customTransport.CloseIdleConnections()
		}

		start := time.Now()
		// codeql[go/request-forgery] false positive: fuzzer needs to request arbitrary user URLs
		resp, err := clientToUse.Do(req)
		duration := time.Since(start).Milliseconds()

		if err == nil && (logger.IsDebugEnabled() || r.config.Settings.Debug) {
			dump, _ := httputil.DumpResponse(resp, false)
			r.logDebug("\n--- Fuzz Response ---\n%s\n---------------------", string(dump))
		}

		if err != nil {
			reqCancel()
			errMsg := err.Error()
			if ctx.Err() != nil {
				errMsg = fmt.Sprintf("Request timed out after %dms", timeoutMs)
			}
			return &swagger.FuzzResult{
				ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
				Method: method, Profile: profile, Status: 0, Duration: duration,
				Payload: payload, PayloadSize: payloadSize, Error: errMsg, Timestamp: time.Now().UnixMilli(), Retries: attempt,
				RequestHeaders: mergedHeaders,
			}
		}

		// Handle 429 with backoff
		if resp.StatusCode == 429 && attempt < maxRetriesOn429 {
			resp.Body.Close() // #nosec G104 -- error from Body.Close irrelevant after 429 backoff
			reqCancel()

			var backoff time.Duration
			if enableAdaptiveRateLimit {
				retryAfter := resp.Header.Get("Retry-After")
				if retryAfter != "" {
					if seconds, err := strconv.Atoi(retryAfter); err == nil {
						backoff = time.Duration(seconds) * time.Second
					} else if httpDate, err := http.ParseTime(retryAfter); err == nil {
						backoff = time.Until(httpDate)
					}
					const maxBackoff = 30 * time.Second
					if backoff > maxBackoff {
						backoff = maxBackoff
					}
				}
			}

			if backoff <= 0 {
				backoff = time.Duration(defaultBackoffMs*(attempt+1)) * time.Millisecond
			}

			jitter := time.Duration(payloads.IntRange(0, 500)) * time.Millisecond
			timer := time.NewTimer(backoff + jitter)
			select {
			case <-timer.C:
				timer.Stop()
				continue
			case <-ctx.Done():
				timer.Stop()
				return &swagger.FuzzResult{
					ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
					Method: method, Profile: profile, Status: 429, Duration: duration,
					Payload: payload, PayloadSize: payloadSize, Timestamp: time.Now().UnixMilli(), Retries: attempt,
					RequestHeaders: mergedHeaders,
				}
			}
		}

		var respBody any
		var rawBodyBytes []byte
		needsBody := resp.StatusCode >= 400 || r.config.Settings.AnalyzeResponseBody || r.hasChainingRuleFor(originalPath)
		if needsBody {
			buf := bufPool.Get().(*bytes.Buffer)
			buf.Reset()
			io.Copy(buf, io.LimitReader(resp.Body, 51200)) // #nosec G104 -- error intentionally ignored; buf.Len() check handles empty reads
			if buf.Len() > 0 {
				rawBodyBytes = bytes.Clone(buf.Bytes())
				var parsed any
				if json.Unmarshal(rawBodyBytes, &parsed) == nil {
					respBody = parsed
				} else {
					respBody = string(rawBodyBytes)
				}
			}
			bufPool.Put(buf)
		}
		discarded, _ := io.Copy(io.Discard, resp.Body) // #nosec G104 -- drain remaining body for connection reuse
		resp.Body.Close()                              // #nosec G104 -- close error irrelevant after body fully consumed
		reqCancel()

		// Extract and save CSRF token if present
		r.extractAndSaveCSRFToken(resp, rawBodyBytes)
		r.extractChainingVariables(originalPath, resp, rawBodyBytes)

		// Check for session expiration and trigger re-auth
		if r.isSessionExpired(resp, rawBodyBytes, mergedHeaders, cookies, profile) && attempt < 1 {
			newHeaders, newCookies, refreshed, reauthErr := r.MaybeReauthenticate(ctx, mergedHeaders, cookies)
			if reauthErr != nil {
				r.logError("Automatic re-authentication failed: %v", reauthErr)
			} else if refreshed {
				// Update cookies/headers for retry
				cookies = newCookies
				mergedHeaders = make(map[string]string)
				for k, v := range generatedHeaders {
					mergedHeaders[k] = r.subStateVars(v)
				}
				r.configMu.RLock()
				for k, v := range newHeaders {
					mergedHeaders[k] = r.subStateVars(r.subVarsLocked(v))
				}
				// Re-calculate rawURL with new variables if any
				base, parseErr := url.Parse(strings.TrimRight(baseURL, "/"))
				if parseErr == nil {
					rawURL = base.JoinPath(resolvedPath).String()
				} else {
					rawURL = strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(resolvedPath, "/")
				}
				rawURL = r.subStateVars(r.subVarsLocked(rawURL))
				r.configMu.RUnlock()

				if len(queryParams) > 0 {
					if parsedURL, err := url.Parse(rawURL); err == nil {
						query := parsedURL.Query()
						for k, v := range queryParams {
							query.Set(k, r.subStateVars(fmt.Sprintf("%v", v)))
						}
						parsedURL.RawQuery = query.Encode()
						rawURL = parsedURL.String()
					}
				}

				continue // Retry request with new auth session
			}
		}

		responseSize := resp.ContentLength
		if responseSize < 0 {
			responseSize = int64(len(rawBodyBytes)) + discarded
		}
		if logger.IsDebugEnabled() && originalPath == "/users" {
			r.logDebug("Users response: status=%d ContentLength=%d len(rawBodyBytes)=%d discarded=%d AnalyzeResponseBody=%t",
				resp.StatusCode, resp.ContentLength, len(rawBodyBytes), discarded, r.config.Settings.AnalyzeResponseBody)
		}

		result := &swagger.FuzzResult{
			ID:              uuid.New().String(),
			Endpoint:        originalPath,
			ResolvedPath:    resolvedPath,
			Method:          method,
			Profile:         profile,
			Status:          resp.StatusCode,
			Duration:        duration,
			Payload:         mergePayload(payload, queryParams),
			PayloadSize:     payloadSize,
			ResponseBody:    respBody,
			ResponseSize:    responseSize,
			ResponseHeaders: resp.Header,
			RequestHeaders:  mergedHeaders,
			Timestamp:       time.Now().UnixMilli(),
		}

		if profile != swagger.FuzzingProfile("BOLA") {
			r.harvestFromResponse(originalPath, method, resp.StatusCode, respBody)
		}

		if r.config.Settings.AnalyzeResponseBody {
			var baselineSize int64
			if profile == swagger.ProfileMalicious {
				baselineSize = r.getSizeBaselineMedian(method, originalPath)
			}
			multiplier := r.config.Settings.ResponseSizeAnomalyMultiplier
			if multiplier <= 0 {
				multiplier = 5.0
			}
			baselineTime := r.getTimeBaselineMedian(method, originalPath)
			input := &analyzer.AnalysisInput{
				SentPayload:     result.Payload,
				ResponseBody:    rawBodyBytes,
				ResponseHeaders: resp.Header,
				Duration:        duration,
				Profile:         profile,
				Endpoint:        originalPath,
				Method:          method,
				ResponseSize:    responseSize,
				BaselineSize:    baselineSize,
				SizeMultiplier:  multiplier,
				BaselineTimeMs:  baselineTime,
				TimeThresholdMs: r.config.Settings.TimeAnomalyThresholdMs,
			}
			result.AnalyzerFindings = r.analyzer.Analyze(input)
			if (logger.IsDebugEnabled() || r.config.Settings.Debug) && len(result.AnalyzerFindings) > 0 {
				r.logDebug("Analyzer: Found findings for %s %s: %v", method, originalPath, result.AnalyzerFindings)
			}
			if logger.IsDebugEnabled() && profile == swagger.ProfileMalicious && originalPath == "/users" {
				r.logDebug("Users anomaly check: method=%s baseline=%d observed=%d mult=%.1f findings=%d payload=%v",
					method, baselineSize, responseSize, multiplier, len(result.AnalyzerFindings), result.Payload)
			}
		}

		return result
	}
}

func (r *Runner) hasChainingRuleFor(endpoint string) bool {
	r.configMu.RLock()
	defer r.configMu.RUnlock()
	for _, cr := range r.config.Settings.ChainingRules {
		if cr.SourceEndpoint == endpoint {
			return true
		}
	}
	return false
}

func (r *Runner) extractChainingVariables(endpoint string, resp *http.Response, rawBody []byte) {
	r.configMu.RLock()
	rules := r.config.Settings.ChainingRules
	r.configMu.RUnlock()

	for _, cr := range rules {
		if cr.SourceEndpoint != endpoint {
			continue
		}
		var valStr string
		switch cr.ExtractType {
		case "json":
			res := tidwallgjson.GetBytes(rawBody, cr.ExtractPath)
			if res.Exists() {
				valStr = res.String()
			}
		case "header":
			valStr = resp.Header.Get(cr.ExtractPath)
		case "regex":
			r.regexCacheMu.RLock()
			re := r.regexCache[cr.ExtractPath]
			r.regexCacheMu.RUnlock()
			if re == nil {
				compiled, err := regexp.Compile(cr.ExtractPath)
				if err == nil {
					re = compiled
					r.regexCacheMu.Lock()
					r.regexCache[cr.ExtractPath] = re
					r.regexCacheMu.Unlock()
				}
			}
			if re != nil {
				matches := re.FindSubmatch(rawBody)
				if len(matches) > 1 {
					valStr = string(matches[1])
				} else if len(matches) > 0 {
					valStr = string(matches[0])
				}
			}
		}

		if valStr != "" {
			r.stateMu.Lock()
			r.state[cr.VariableName] = valStr
			r.updateStateReplacerLocked()
			r.stateMu.Unlock()
		}
	}
}

func (r *Runner) executeMCPRequest(
	ctx context.Context,
	originalPath string,
	payload any,
	profile swagger.FuzzingProfile,
) *swagger.FuzzResult {
	if r.mcpClient == nil {
		return &swagger.FuzzResult{
			ID:           uuid.New().String(),
			Endpoint:     originalPath,
			ResolvedPath: originalPath,
			Method:       "CALL",
			Profile:      profile,
			Payload:      payload,
			Status:       500,
			Error:        "MCP client is not initialized",
			ResponseBody: "Error: MCP client is not initialized",
			Timestamp:    time.Now().UnixMilli(),
		}
	}

	toolName := strings.TrimPrefix(originalPath, "mcp://tool/")
	var args map[string]any
	if payload != nil {
		if m, ok := payload.(map[string]any); ok {
			args = m
		} else {
			if b, err := json.Marshal(payload); err == nil {
				_ = json.Unmarshal(b, &args)
			}
		}
	}

	payloadSize := 0
	if b, err := json.Marshal(args); err == nil {
		payloadSize = len(b)
	}

	timeoutMs := 10000
	r.configMu.RLock()
	if r.config.Settings.TimeoutMs > 0 {
		timeoutMs = r.config.Settings.TimeoutMs
	}
	r.configMu.RUnlock()

	reqCtx, reqCancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer reqCancel()

	// Initialize result early for potential early returns
	result := &swagger.FuzzResult{
		ID:           uuid.New().String(),
		Endpoint:     originalPath,
		ResolvedPath: originalPath,
		Method:       "CALL",
		Profile:      profile,
		Payload:      args,
		PayloadSize:  payloadSize,
		Timestamp:    time.Now().UnixMilli(),
	}

	// Apply rate limiting to prevent DoS
	// Use a separate rate limiter per runner to allow configurable limits
	if r.mcpRateLimiter == nil {
		// Import mcp package for rate limiter
		r.mcpRateLimiter = mcp.NewRateLimiter(100, 50) // 100 req/sec, max 50 waiting
	}
	if !r.mcpRateLimiter.Allow(reqCtx) {
		result.Error = "Rate limit exceeded for MCP calls"
		result.Status = 429
		result.ResponseBody = "Error: Too many concurrent MCP requests"
		return result
	}

	startTime := time.Now()
	res, stderr, err := r.mcpClient.CallTool(reqCtx, toolName, args)
	duration := time.Since(startTime)

	// Update result with call details
	result.Duration = duration.Milliseconds()

	if err != nil {
		result.Status = 500
		result.Error = fmt.Sprintf("MCP Call failed: %v", err)
		if stderr != "" {
			result.ResponseBody = fmt.Sprintf("Error: %v\nStderr: %s", err, stderr)
		} else {
			result.ResponseBody = fmt.Sprintf("Error: %v", err)
		}
		errMsg := strings.ToLower(err.Error())
		// Check for server crash indicators more precisely
		isCrash := strings.Contains(errMsg, "exit status") || strings.Contains(errMsg, "process terminated") || 
			strings.Contains(errMsg, "channel closed") || strings.Contains(errMsg, "broken pipe") ||
			strings.Contains(errMsg, "signal") || strings.Contains(errMsg, "killed")
		if isCrash {
			// Mask sensitive data in evidence - args not included to prevent sensitive info leak
			result.AnalyzerFindings = append(result.AnalyzerFindings, swagger.AnalysisFinding{
				RuleID:   "swazz/mcp-server-crash",
				Level:    "error",
				Message:  "The MCP server crashed or returned a server error during the tool invocation.",
				Evidence: fmt.Sprintf("Tool: %s\nError: %s\nStderr: %s", toolName, err.Error(), stderr),
			})
		}
		return result
	}

	if res != nil && res.IsError {
		result.Status = 400
		hasCrash := false
		for _, content := range res.Content {
			if content.Type == "text" {
				textLower := strings.ToLower(content.Text)
				if strings.Contains(textLower, "exception") || strings.Contains(textLower, "stacktrace") || strings.Contains(textLower, "crash") || strings.Contains(textLower, "panic") {
					hasCrash = true
					break
				}
			}
		}
		if hasCrash {
			result.Status = 500
		}
	} else {
		result.Status = 200
	}
	var resBytes []byte
	if res != nil {
		resBytes, _ = json.Marshal(res)
	}
	result.ResponseBody = string(resBytes)
	result.ResponseSize = int64(len(resBytes))

	if r.config.Settings.AnalyzeResponseBody {
		input := &analyzer.AnalysisInput{
			SentPayload:     result.Payload,
			ResponseBody:    resBytes,
			Duration:        duration.Milliseconds(),
			Profile:         profile,
			Endpoint:        originalPath,
			Method:          "CALL",
			ResponseSize:    result.ResponseSize,
			BaselineSize:    0,
			SizeMultiplier:  5.0,
			BaselineTimeMs:  0,
			TimeThresholdMs: 0,
		}
		result.AnalyzerFindings = r.analyzer.Analyze(input)

		if res != nil {
			for _, content := range res.Content {
				if content.Type == "text" {
					textLower := strings.ToLower(content.Text)
					if strings.Contains(textLower, "exception") || strings.Contains(textLower, "stacktrace") || strings.Contains(textLower, "sql syntax") {
						result.AnalyzerFindings = append(result.AnalyzerFindings, swagger.AnalysisFinding{
							RuleID:   "swazz/mcp-tool-error-reflection",
							Level:    "error",
							Message:  fmt.Sprintf("The tool returned an error or exception signature in its content: %s", content.Text),
							Evidence: fmt.Sprintf("Tool: %s\nText: %s", toolName, content.Text),
						})
					}
				}
			}
		}
	}

	return result
}
