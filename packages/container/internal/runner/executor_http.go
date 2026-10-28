// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
)

// maxResponseRead is how much of a response body is read in all: the analyzers' prefix and then
// the drain that keeps the connection reusable and measures a body sent without a Content-Length.
// The target controls the body; past this much it is dropped with its connection. It sits well
// above the size baselines the response-size-anomaly analyzer compares against.
const maxResponseRead = 8 << 20

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
	if r.waitWhileHeld(ctx) {
		// Stopped while held: the request was never sent, and must not pass for a timeout.
		return &swagger.FuzzResult{
			ID:           uuid.New().String(),
			Endpoint:     originalPath,
			ResolvedPath: resolvedPath,
			Method:       method,
			Profile:      profile,
			Error:        "not sent: the scan stopped while it was held",
			NotSent:      true,
			Timestamp:    time.Now().UnixMilli(),
		}
	}
	if strings.HasPrefix(originalPath, "mcp://") {
		return r.executeMCPRequest(ctx, originalPath, payload, profile, headers, cookies)
	}
	if strings.HasPrefix(originalPath, "webmcp://") {
		// WebMCP tools live inside a browser page (navigator.modelContext) and can
		// only be invoked from that page. There is no network executor for them yet,
		// so fail closed: falling through would send a nonsense "CALL <base>/webmcp://..."
		// HTTP request to the target and feed its error page to the MCP analyzers.
		return &swagger.FuzzResult{
			ID:           uuid.New().String(),
			Endpoint:     originalPath,
			ResolvedPath: originalPath,
			Method:       method,
			Profile:      profile,
			Payload:      payload,
			Error:        "webmcp:// endpoints require a browser-side executor and are not fuzzed over HTTP",
			Timestamp:    time.Now().UnixMilli(),
		}
	}
	if method == "GRPC" || strings.HasPrefix(baseURL, "grpc://") || strings.HasPrefix(baseURL, "grpcs://") {
		return r.executeGRPCRequest(ctx, baseURL, resolvedPath, originalPath, payload, profile, generatedHeaders)
	}
	if method == "WS" || strings.HasPrefix(baseURL, "ws://") || strings.HasPrefix(baseURL, "wss://") {
		return r.executeWebSocketRequest(ctx, baseURL, resolvedPath, originalPath, method, payload, profile, headers, generatedHeaders)
	}

	// Merge headers: generatedHeaders < global headers
	isBody := !isNoBodyMethod(method)
	mergedHeaders := make(map[string]string, len(generatedHeaders)+len(headers)+2)
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
	if isBody && !hasContentType {
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
				query.Set(k, r.subStateVars(toString(v)))
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
		var reqBody []byte
		if isBody && payload != nil {
			if strings.Contains(effectiveCT, "x-www-form-urlencoded") {
				if m, ok := payload.(map[string]any); ok {
					vals := url.Values{}
					for k, v := range m {
						vals.Set(k, toString(v))
					}
					reqBody = []byte(vals.Encode())
					bodyReader = bytes.NewReader(reqBody)
				}
			}
			if bodyReader == nil && strings.Contains(effectiveCT, "xml") {
				if m, ok := payload.(map[string]any); ok {
					xmlContent, _ := generator.ToXML(m, "request")
					soapBody, _ := generator.WrapInSOAP(xmlContent)
					reqBody = []byte(soapBody)
					bodyReader = bytes.NewReader(reqBody)
				}
			}

			if bodyReader == nil {
				reqBody, _ = json.Marshal(payload)
				bodyReader = bytes.NewReader(reqBody)
			}
			payloadSize = len(reqBody)
		}

		if len(cookies) > 0 {
			var sb strings.Builder
			i := 0
			for k, v := range cookies {
				if i > 0 {
					sb.WriteString("; ")
				}
				sb.WriteString(k)
				sb.WriteByte('=')
				sb.WriteString(v)
				i++
			}
			mergedHeaders["Cookie"] = sb.String()
		}

		req, err := http.NewRequestWithContext(reqCtx, method, rawURL, bodyReader)
		if err != nil {
			reqCancel()
			return &swagger.FuzzResult{
				ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
				RequestURI: requestURIOf(rawURL),
				Method:     method, Profile: profile, Status: 0, Payload: mergePayload(payload, queryParams), PayloadSize: payloadSize,
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

		if logger.IsDebugEnabled() || r.config.Settings.Debug {
			if reqDump, dumpErr := httputil.DumpRequestOut(req, true); dumpErr == nil {
				r.logDebug("\n--- Fuzz Request ---\n%s\n--------------------", string(reqDump))
			}
		}

		// Look for OOB payloads to register the actual request details
		if profile == swagger.ProfileMalicious {
			if matches := oobUUIDsInRequest(rawURL, mergedHeaders, reqBody); len(matches) > 0 {
				reqLog := &swagger.RequestLog{
					Method:       method,
					URL:          rawURL,
					Headers:      mergedHeaders,
					OriginalPath: originalPath,
					ResolvedPath: req.URL.RequestURI(),
					Body:         string(reqBody),
				}
				for _, uuidMatch := range matches {
					r.oobStore.UpdateRequest(uuidMatch, reqLog)
				}
			}
		}

		clientToUse := r.client
		if len(proxyList) > 0 {
			clientToUse = r.proxiedClient()
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
				RequestURI: req.URL.RequestURI(),
				Method:     method, Profile: profile, Status: 0, Duration: duration,
				Payload: mergePayload(payload, queryParams), PayloadSize: payloadSize, Error: errMsg, Timestamp: time.Now().UnixMilli(), Retries: attempt,
				RequestHeaders: mergedHeaders,
			}
		}

		// Handle 429 with backoff
		if resp.StatusCode == 429 && attempt < maxRetriesOn429 {
			// Drained before closing so the connection is kept for the retry.
			safenet.DrainBody(resp.Body, maxResponseRead)
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
					RequestURI: req.URL.RequestURI(),
					Method:     method, Profile: profile, Status: 429, Duration: duration,
					Payload: mergePayload(payload, queryParams), PayloadSize: payloadSize, Timestamp: time.Now().UnixMilli(), Retries: attempt,
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
			PutBuffer(buf)
		}
		discarded := safenet.DrainBody(resp.Body, maxResponseRead-int64(len(rawBodyBytes)))
		resp.Body.Close() // #nosec G104 -- close error irrelevant once the body is no longer read
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
				hasCT := false
				for k := range mergedHeaders {
					if strings.EqualFold(k, "content-type") {
						hasCT = true
						break
					}
				}
				if isBody && !hasCT {
					mergedHeaders["Content-Type"] = effectiveCT
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
							query.Set(k, r.subStateVars(toString(v)))
						}
						parsedURL.RawQuery = query.Encode()
						rawURL = parsedURL.String()
					}
				}

				continue // Retry request with new auth session
			}
		}

		// Without a Content-Length this is what was read: for a body cut off past maxResponseRead,
		// a lower bound.
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
			RequestURI:      req.URL.RequestURI(),
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

		// Only responses to the scan's own identity feed it: BOLA and DIFFERENTIAL probes go out
		// as other identities or anonymously, and must not set User A's variables.
		switch profile {
		case swagger.ProfileRandom, swagger.FuzzingProfile("BASELINE"):
			r.detector.Load().HarvestFromResponse(originalPath, method, resp.StatusCode, respBody, payload, queryParams)
		case swagger.ProfileMalicious, swagger.ProfileBoundary:
			// The target may echo these payloads in ID-like fields: not IDs to replay.
			r.detector.Load().ExtractVariablesFromResponse(originalPath, method, resp.StatusCode, respBody)
		}

		if r.config.Settings.AnalyzeResponseBody {
			baselineSize, multiplier, baselineTime := r.anomalyBaselines(method, originalPath, profile, r.config.Settings)
			input := analyzer.AcquireInput(analyzer.AnalysisInput{
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
				Settings:        r.config.Settings,
			})
			result.AnalyzerFindings = r.analyzer.Analyze(input)
			analyzer.ReleaseInput(input)
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

// oobUUIDsInRequest returns the UUIDs (OOB callback tokens) a request carries in its URL, header
// names and values, and body: every part of the wire request a payload can reach.
func oobUUIDsInRequest(rawURL string, headers map[string]string, body []byte) []string {
	matches := uuidRegex.FindAllString(rawURL, -1)
	for k, v := range headers {
		matches = append(matches, uuidRegex.FindAllString(k, -1)...)
		matches = append(matches, uuidRegex.FindAllString(v, -1)...)
	}
	for _, m := range uuidRegex.FindAll(body, -1) {
		matches = append(matches, string(m))
	}
	return matches
}
