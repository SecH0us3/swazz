package ratelimit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

// Check sends a burst of requests to verify if rate limiting is present.
func Check(
	ctx context.Context,
	client *http.Client,
	baseURL string,
	resolvedPath string,
	originalPath string,
	method string,
	headers map[string]string,
	payload any,
	queryParams map[string]any,
	contentType string,
	burstSize int,
	timeoutMs int,
) (*classifier.Finding, int, int) {
	if burstSize <= 0 {
		burstSize = 50
	}
	if timeoutMs <= 0 {
		timeoutMs = 10000
	}

	// Prepare URL
	rawURL := strings.TrimRight(baseURL, "/") + resolvedPath
	if len(queryParams) > 0 {
		if parsedURL, err := url.Parse(rawURL); err == nil {
			query := parsedURL.Query()
			for k, v := range queryParams {
				query.Set(k, fmt.Sprintf("%v", v))
			}
			parsedURL.RawQuery = query.Encode()
			rawURL = parsedURL.String()
		}
	}

	// Prepare Headers
	isBody := !strings.EqualFold(method, "GET") && !strings.EqualFold(method, "HEAD") && !strings.EqualFold(method, "OPTIONS") && !strings.EqualFold(method, "DELETE")
	effectiveCT := contentType
	if effectiveCT == "" {
		effectiveCT = "application/json"
	}
	mergedHeaders := make(map[string]string)
	for k, v := range headers {
		mergedHeaders[k] = v
	}
	hasContentType := false
	for k := range mergedHeaders {
		if strings.EqualFold(k, "content-type") {
			hasContentType = true
			break
		}
	}
	if isBody && payload != nil && !hasContentType {
		mergedHeaders["Content-Type"] = effectiveCT
	}

	// Prepare Body
	var bodyBytes []byte
	if isBody && payload != nil {
		if strings.Contains(effectiveCT, "x-www-form-urlencoded") {
			if m, ok := payload.(map[string]any); ok {
				vals := url.Values{}
				for k, v := range m {
					vals.Set(k, fmt.Sprintf("%v", v))
				}
				bodyBytes = []byte(vals.Encode())
			}
		}
		if bodyBytes == nil && strings.Contains(effectiveCT, "xml") {
			if m, ok := payload.(map[string]any); ok {
				xmlContent, _ := generator.ToXML(m, "request")
				soapBody, _ := generator.WrapInSOAP(xmlContent)
				bodyBytes = []byte(soapBody)
			}
		}
		if bodyBytes == nil {
			bodyBytes, _ = json.Marshal(payload)
		}
	}

	var wg sync.WaitGroup
	var totalSent int32
	var total429s int32
	var first429At int32 // sequence index (1-based)
	var retryAfterVal string
	var retryAfterMu sync.Mutex

	startTime := time.Now()

	// Launch burstSize concurrent requests
	for i := 1; i <= burstSize; i++ {
		wg.Add(1)
		go func(seq int) {
			defer wg.Done()

			// Check context before sending
			if ctx.Err() != nil {
				return
			}

			reqCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
			defer cancel()

			var bodyReader io.Reader
			if len(bodyBytes) > 0 {
				bodyReader = bytes.NewReader(bodyBytes)
			}

			req, err := http.NewRequestWithContext(reqCtx, method, rawURL, bodyReader)
			if err != nil {
				return
			}

			for k, v := range mergedHeaders {
				if strings.EqualFold(k, "Host") {
					req.Host = v
				} else {
					req.Header.Set(k, v)
				}
			}

			atomic.AddInt32(&totalSent, 1)
			resp, err := client.Do(req)
			if err != nil {
				return
			}
			defer resp.Body.Close()
			_, _ = io.Copy(io.Discard, resp.Body)

			if resp.StatusCode == http.StatusTooManyRequests { // 429
				atomic.AddInt32(&total429s, 1)

				// Track first 429 (using CAS for thread safety)
				for {
					currFirst := atomic.LoadInt32(&first429At)
					if currFirst != 0 && currFirst <= int32(seq) {
						break
					}
					if atomic.CompareAndSwapInt32(&first429At, currFirst, int32(seq)) {
						break
					}
				}

				if ra := resp.Header.Get("Retry-After"); ra != "" {
					retryAfterMu.Lock()
					if retryAfterVal == "" {
						retryAfterVal = ra
					}
					retryAfterMu.Unlock()
				}
			}
		}(i)
	}

	wg.Wait()
	duration := time.Since(startTime)

	sentCount := int(atomic.LoadInt32(&totalSent))
	count429 := int(atomic.LoadInt32(&total429s))
	first429 := int(atomic.LoadInt32(&first429At))

	// If zero 429 responses were received, it means rate limiting is NOT enforced.
	if count429 == 0 && sentCount > 0 {
		evidence := fmt.Sprintf("Sent %d requests in %.2fs, received 0 rate-limit responses (429)", sentCount, duration.Seconds())
		finding := &classifier.Finding{
			RuleID:       "swazz/no-rate-limit",
			Level:        classifier.SeverityWarning,
			Endpoint:     originalPath,
			ResolvedPath: resolvedPath,
			Method:       method,
			Profile:      swagger.FuzzingProfile("RATE-LIMIT"),
			Status:       200, // Or whatever successful status was received
			Duration:     duration.Milliseconds(),
			Payload:      nil,
			ResponseBody: evidence,
			Source:       "rate_limiting",
			Timestamp:    time.Now().UnixMilli(),
		}
		return finding, sentCount, count429
	}

	// If rate limiting is active, report it as an informational Note finding.
	if count429 > 0 {
		var retryStr string
		if retryAfterVal != "" {
			retryStr = fmt.Sprintf(" (Retry-After: %s)", retryAfterVal)
		}
		evidence := fmt.Sprintf("Rate limiting is active. Sent %d requests, received %d rate-limit responses (429). First 429 at request %d%s", sentCount, count429, first429, retryStr)
		finding := &classifier.Finding{
			RuleID:       "swazz/rate-limit-active",
			Level:        classifier.SeverityNote,
			Endpoint:     originalPath,
			ResolvedPath: resolvedPath,
			Method:       method,
			Profile:      swagger.FuzzingProfile("RATE-LIMIT"),
			Status:       429,
			Duration:     duration.Milliseconds(),
			Payload:      nil,
			ResponseBody: evidence,
			Source:       "rate_limiting",
			Timestamp:    time.Now().UnixMilli(),
		}
		return finding, sentCount, count429
	}

	return nil, sentCount, count429
}
