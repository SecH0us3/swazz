package runner

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

	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"

	"github.com/google/uuid"
)

const (
	maxRetriesOn429  = 3
	defaultBackoffMs = 2000
)

// Event types for SSE streaming.
const (
	EventResult   = "result"
	EventProgress = "progress"
	EventComplete = "complete"
	EventError    = "error"
)

// Event represents a streaming event sent to subscribers.
type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

var bufPool = sync.Pool{
	New: func() any {
		return new(bytes.Buffer)
	},
}

// JSON serializes the event data.
func (e *Event) JSON() string {
	b, _ := json.Marshal(e.Data)
	return string(b)
}

// Runner orchestrates fuzzing runs across endpoints × profiles × iterations.
type Runner struct {
	config *swagger.Config
	client *http.Client

	mu         sync.Mutex
	isRunning  bool
	isPaused   bool
	shouldStop bool
	stats      swagger.RunStats
	cancel     context.CancelFunc

	// SSE subscribers
	subsMu sync.RWMutex
	subs   map[chan Event]struct{}
}

// New creates a new Runner.
func New(config *swagger.Config, client *http.Client) *Runner {
	if client == nil {
		client = &http.Client{
			Transport: &http.Transport{
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 20,
				IdleConnTimeout:     90 * time.Second,
			},
		}
	}
	return &Runner{
		config: config,
		client: client,
		stats:  newEmptyStats(),
		subs:   make(map[chan Event]struct{}),
	}
}

// Subscribe returns a channel for receiving live events.
func (r *Runner) Subscribe() chan Event {
	ch := make(chan Event, 64)
	r.subsMu.Lock()
	r.subs[ch] = struct{}{}
	r.subsMu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber channel.
func (r *Runner) Unsubscribe(ch chan Event) {
	r.subsMu.Lock()
	delete(r.subs, ch)
	r.subsMu.Unlock()
	close(ch)
}

func (r *Runner) broadcast(evt Event) {
	r.subsMu.RLock()
	defer r.subsMu.RUnlock()
	for ch := range r.subs {
		select {
		case ch <- evt:
		default:
			// Drop if subscriber is slow
		}
	}
}

// Start begins the fuzzing run. Blocks until complete or stopped.
func (r *Runner) Start(ctx context.Context) error {
	r.mu.Lock()
	if r.isRunning {
		r.mu.Unlock()
		return fmt.Errorf("already running")
	}
	r.isRunning = true
	r.isPaused = false
	r.shouldStop = false
	r.stats = newEmptyStats()

	ctx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.mu.Unlock()

	defer func() {
		cancel()
		r.mu.Lock()
		r.isRunning = false
		r.stats.IsRunning = false
		r.stats.Progress.CurrentEndpoint = ""
		r.stats.Progress.CurrentProfile = ""
		r.mu.Unlock()

		r.broadcast(Event{Type: EventComplete, Data: r.GetStats()})
	}()

	cfg := r.config
	settings := cfg.Settings
	endpoints := cfg.Endpoints
	iterations := settings.IterationsPerProfile
	concurrency := settings.Concurrency
	delay := time.Duration(settings.DelayBetweenRequestMs) * time.Millisecond
	defaultMaxPayloadSize := settings.MaxPayloadSizeBytes
	if defaultMaxPayloadSize <= 0 {
		defaultMaxPayloadSize = 1048576 // 1MB default
	}

	// Reorder profiles to run heavier ones last
	var lightProfiles, heavyList []swagger.FuzzingProfile
	for _, p := range settings.Profiles {
		if p == swagger.ProfileBoundary {
			heavyList = append(heavyList, p)
		} else {
			lightProfiles = append(lightProfiles, p)
		}
	}
	profiles := append(lightProfiles, heavyList...)

	// Calculate total planned requests
	var totalPlanned int64
	for _, ep := range endpoints {
		hasF := hasFields(&ep)
		for _, p := range profiles {
			minNeeded := generator.MinIterationsNeeded(p)
			baseIter := iterations
			if minNeeded > baseIter {
				baseIter = minNeeded
			}
			if !hasF {
				baseIter = 1
			}
			totalPlanned += int64(baseIter)
		}
	}
	atomic.StoreInt64(&r.stats.TotalPlanned, totalPlanned)
	r.stats.Progress.TotalEndpoints = len(endpoints) * len(profiles)

	for profileIdx, profile := range profiles {
		if r.stopped() {
			break
		}

		r.mu.Lock()
		r.stats.Progress.CurrentProfile = string(profile)
		r.mu.Unlock()

		for epIdx, endpoint := range endpoints {
			if r.stopped() {
				break
			}

			epKey := fmt.Sprintf("%s %s", endpoint.Method, endpoint.Path)
			r.mu.Lock()
			r.stats.Progress.CurrentEndpoint = epKey
			r.stats.Progress.CompletedEndpoints = profileIdx*len(endpoints) + epIdx
			r.mu.Unlock()

			r.broadcast(Event{Type: EventProgress, Data: r.GetStats()})

			minNeeded := generator.MinIterationsNeeded(profile)
			effectiveIterations := iterations
			if minNeeded > effectiveIterations {
				effectiveIterations = minNeeded
			}
			if !hasFields(&endpoint) {
				effectiveIterations = 1
			}

			// Calculate max payload size for this specific profile
			currentMaxPayloadSize := defaultMaxPayloadSize
			if profile == swagger.ProfileBoundary {
				if currentMaxPayloadSize < 536870912 {
					currentMaxPayloadSize = 536870912
				}
			}
			isBodyMethod := !isNoBodyMethod(endpoint.Method)
			gen := generator.New(cfg.Dictionaries, profile)
			// safeGen always uses RANDOM profile for path/header params.
			// Boundary/malicious values in path segments cause 404s before the payload is processed,
			// which means the body boundary test never actually runs on the server.
			safeGen := generator.New(cfg.Dictionaries, swagger.ProfileRandom)
			profileConcurrency := concurrency

			sem := make(chan struct{}, profileConcurrency)
			enableDedup := profile == swagger.ProfileRandom
			var wg sync.WaitGroup
			seenHashes := make(map[uint32]bool)

			for i := 0; i < effectiveIterations; i++ {
				if r.stopped() {
					break
				}

				var payload any
				var queryParams map[string]any
				var payloadHash uint32 = payloads.HashStr("empty")
				isDuplicate := false

				if hasFields(&endpoint) {
					for retries := 0; retries < 10; retries++ {
						generated := gen.BuildObject(&endpoint.Schema)

						// Enforce max_payload_size_bytes
						buf := bufPool.Get().(*bytes.Buffer)
						buf.Reset()
						err := json.NewEncoder(buf).Encode(generated)

						if err != nil || buf.Len() > currentMaxPayloadSize {
							bufPool.Put(buf)
							isDuplicate = true
							continue
						}

						if isBodyMethod {
							payload = generated
						} else {
							queryParams = generated
						}
						// Strip the trailing newline from NewEncoder
						payloadStr := strings.TrimSuffix(buf.String(), "\n")
						payloadHash = payloads.HashStr(payloadStr)
						bufPool.Put(buf)

						if enableDedup {
							if !seenHashes[payloadHash] {
								isDuplicate = false
								break
							}
							isDuplicate = true
						} else {
							isDuplicate = false
							break
						}
					}
				} else {
					if enableDedup {
						isDuplicate = seenHashes[payloadHash]
					}
				}

				if isDuplicate {
					atomic.AddInt64(&r.stats.TotalPlanned, -1)
					continue
				}
				if enableDedup {
					seenHashes[payloadHash] = true
				}

				// Wait while paused
				for r.paused() && !r.stopped() {
					time.Sleep(100 * time.Millisecond)
				}
				if r.stopped() {
					break
				}

				sem <- struct{}{}
				wg.Add(1)

				capturedPayload := payload
				capturedQueryParams := queryParams
				capturedEndpoint := endpoint
				iterationIndex := i

				go func() {
					defer func() {
						<-sem
						wg.Done()
					}()

					// Use safeGen for path params — valid values only, never boundary/malicious strings.
					resolvedPath := fillPathParams(capturedEndpoint.Path, capturedEndpoint.PathParams, safeGen)

					// Generate header params
					generatedHeaders := make(map[string]string)
					if len(capturedEndpoint.HeaderParams) > 0 {
						headerSchema := &swagger.SchemaProperty{
							Type:       "object",
							Properties: capturedEndpoint.HeaderParams,
						}
						headerObj := gen.BuildObject(headerSchema)
						for k, v := range headerObj {
							generatedHeaders[k] = fmt.Sprintf("%v", v)
						}
					}

					result := r.executeRequest(
						ctx,
						cfg.BaseURL,
						resolvedPath,
						capturedEndpoint.Path,
						capturedEndpoint.Method,
						cfg.GlobalHeaders,
						cfg.Cookies,
						capturedPayload,
						profile,
						capturedQueryParams,
						generatedHeaders,
						capturedEndpoint.ContentType,
					)

					r.mu.Lock()
					r.stats.Progress.CurrentIteration = iterationIndex + 1
					r.stats.Progress.TotalIterations = effectiveIterations
					r.mu.Unlock()

					r.updateStats(result)

					// Send a lightweight SSE event — raw payload never reaches the browser
					r.broadcast(Event{Type: EventResult, Data: toSSE(result)})
					r.broadcast(Event{Type: EventProgress, Data: r.GetStats()})
				}()

				if delay > 0 {
					time.Sleep(delay)
				}
			}

			wg.Wait()

			r.mu.Lock()
			r.stats.Progress.CompletedEndpoints = profileIdx*len(endpoints) + epIdx + 1
			r.mu.Unlock()
			r.broadcast(Event{Type: EventProgress, Data: r.GetStats()})
		}
	}

	return nil
}

// Stop signals the runner to stop.
func (r *Runner) Stop() {
	r.mu.Lock()
	r.shouldStop = true
	r.isPaused = false
	if r.cancel != nil {
		r.cancel()
	}
	r.mu.Unlock()
}

// Pause pauses the runner.
func (r *Runner) Pause() {
	r.mu.Lock()
	if r.isRunning {
		r.isPaused = true
	}
	r.mu.Unlock()
}

// Resume resumes a paused runner.
func (r *Runner) Resume() {
	r.mu.Lock()
	r.isPaused = false
	r.mu.Unlock()
}

// IsRunning returns whether the runner is active.
func (r *Runner) IsRunning() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.isRunning
}

// GetStats returns a snapshot of current stats.
func (r *Runner) GetStats() swagger.RunStats {
	r.mu.Lock()
	defer r.mu.Unlock()
	// Shallow copy maps
	stats := r.stats
	stats.StatusCounts = copyMapIntInt64(r.stats.StatusCounts)
	stats.StatusByProfile = copyMapStatusByProfile(r.stats.StatusByProfile)
	stats.ProfileCounts = copyMapProfileInt64(r.stats.ProfileCounts)
	stats.EndpointCounts = copyMapEndpoint(r.stats.EndpointCounts)
	return stats
}

// ─── Private ────────────────────────────────────────────

func (r *Runner) stopped() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.shouldStop
}

func (r *Runner) paused() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.isPaused
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
	rawURL := strings.TrimRight(baseURL, "/") + resolvedPath

	// Append query parameters
	// Cap each value at 4000 chars — most servers/proxies reject URLs > 8KB (414).
	// Boundary testing of long strings is still possible, just not at megabyte scale in a URL.
	if len(queryParams) > 0 {
		params := url.Values{}
		for k, v := range queryParams {
			s := fmt.Sprintf("%v", v)
			if len(s) > 4000 {
				s = s[:4000]
			}
			params.Set(k, s)
		}
		if strings.Contains(rawURL, "?") {
			rawURL += "&" + params.Encode()
		} else {
			rawURL += "?" + params.Encode()
		}
	}

	// Merge headers: generatedHeaders < global headers
	isBody := !isNoBodyMethod(method)
	mergedHeaders := make(map[string]string)
	for k, v := range generatedHeaders {
		mergedHeaders[k] = v
	}
	for k, v := range headers {
		mergedHeaders[k] = v
	}

	effectiveCT := contentType
	if effectiveCT == "" {
		effectiveCT = "application/json"
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

	timeoutMs := r.config.Settings.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 10000
	}

	for attempt := 0; ; attempt++ {
		payloadSize := 0
		reqCtx, reqCancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)

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
			if bodyReader == nil {
				b, _ := json.Marshal(payload)
				bodyReader = strings.NewReader(string(b))
				payloadSize = len(b)
			}
		}

		req, err := http.NewRequestWithContext(reqCtx, method, rawURL, bodyReader)
		if err != nil {
			reqCancel()
			return &swagger.FuzzResult{
				ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
				Method: method, Profile: profile, Status: 0, Payload: payload, PayloadSize: payloadSize,
				Error: err.Error(), Timestamp: time.Now().UnixMilli(), Retries: attempt,
			}
		}

		for k, v := range mergedHeaders {
			req.Header.Set(k, v)
		}
		if len(cookies) > 0 {
			parts := make([]string, 0, len(cookies))
			for k, v := range cookies {
				parts = append(parts, k+"="+v)
			}
			req.Header.Set("Cookie", strings.Join(parts, "; "))
		}

		start := time.Now()
		resp, err := r.client.Do(req)
		duration := time.Since(start).Milliseconds()
		reqCancel()

		if err != nil {
			errMsg := err.Error()
			if ctx.Err() != nil {
				errMsg = fmt.Sprintf("Request timed out after %dms", timeoutMs)
			}
			return &swagger.FuzzResult{
				ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
				Method: method, Profile: profile, Status: 0, Duration: duration,
				Payload: payload, PayloadSize: payloadSize, Error: errMsg, Timestamp: time.Now().UnixMilli(), Retries: attempt,
			}
		}

		defer resp.Body.Close()

		// Handle 429 with backoff
		if resp.StatusCode == 429 && attempt < maxRetriesOn429 {
			backoff := time.Duration(defaultBackoffMs*(attempt+1)) * time.Millisecond
			jitter := time.Duration(payloads.IntRange(0, 500)) * time.Millisecond
			select {
			case <-time.After(backoff + jitter):
				continue
			case <-ctx.Done():
				return &swagger.FuzzResult{
					ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
					Method: method, Profile: profile, Status: 429, Duration: duration,
					Payload: payload, PayloadSize: payloadSize, Timestamp: time.Now().UnixMilli(), Retries: attempt,
				}
			}
		}

		var respBody any
		if resp.StatusCode >= 400 {
			buf := bufPool.Get().(*bytes.Buffer)
			buf.Reset()
			io.Copy(buf, io.LimitReader(resp.Body, 51200)) // 50KB limit
			if buf.Len() > 0 {
				var parsed any
				if json.Unmarshal(buf.Bytes(), &parsed) == nil {
					respBody = parsed
				} else {
					respBody = buf.String()
				}
			}
			bufPool.Put(buf)
		} else {
			io.Copy(io.Discard, resp.Body) // drain body to reuse connection
		}

		return &swagger.FuzzResult{
			ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
			Method: method, Profile: profile, Status: resp.StatusCode, Duration: duration,
			Payload: mergePayload(payload, queryParams), PayloadSize: payloadSize, ResponseBody: respBody,
			Timestamp: time.Now().UnixMilli(), Retries: attempt,
		}
	}
}

func (r *Runner) updateStats(result *swagger.FuzzResult) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.stats.TotalRequests++
	r.stats.IsRunning = true

	status := result.Status
	if r.stats.StatusCounts == nil {
		r.stats.StatusCounts = make(map[int]int64)
	}
	r.stats.StatusCounts[status]++

	if r.stats.StatusByProfile == nil {
		r.stats.StatusByProfile = make(map[swagger.FuzzingProfile]map[int]int64)
	}
	if r.stats.StatusByProfile[result.Profile] == nil {
		r.stats.StatusByProfile[result.Profile] = make(map[int]int64)
	}
	r.stats.StatusByProfile[result.Profile][status]++

	if r.stats.ProfileCounts == nil {
		r.stats.ProfileCounts = make(map[swagger.FuzzingProfile]int64)
	}
	r.stats.ProfileCounts[result.Profile]++

	epKey := fmt.Sprintf("%s %s", strings.ToUpper(result.Method), result.Endpoint)
	if r.stats.EndpointCounts == nil {
		r.stats.EndpointCounts = make(map[string]map[int]int64)
	}
	if r.stats.EndpointCounts[epKey] == nil {
		r.stats.EndpointCounts[epKey] = make(map[int]int64)
	}
	r.stats.EndpointCounts[epKey][status]++

	elapsed := float64(time.Now().UnixMilli()-r.stats.StartTime) / 1000.0
	if elapsed > 0 {
		r.stats.RequestsPerSec = float64(int(float64(r.stats.TotalRequests)/elapsed*10)) / 10
	}
}

// ─── Helpers ────────────────────────────────────────────

func newEmptyStats() swagger.RunStats {
	return swagger.RunStats{
		StatusCounts:    make(map[int]int64),
		StatusByProfile: make(map[swagger.FuzzingProfile]map[int]int64),
		ProfileCounts:   make(map[swagger.FuzzingProfile]int64),
		EndpointCounts:  make(map[string]map[int]int64),
		StartTime:       time.Now().UnixMilli(),
	}
}

func hasFields(ep *swagger.EndpointConfig) bool {
	return (ep.Schema.Properties != nil && len(ep.Schema.Properties) > 0) ||
		(ep.PathParams != nil && len(ep.PathParams) > 0) ||
		(ep.HeaderParams != nil && len(ep.HeaderParams) > 0)
}

func isNoBodyMethod(method string) bool {
	m := strings.ToUpper(method)
	return m == "GET" || m == "HEAD" || m == "OPTIONS"
}

func fillPathParams(path string, pathParams map[string]*swagger.SchemaProperty, gen *generator.Generator) string {
	if len(pathParams) == 0 && !strings.Contains(path, "{") {
		return path
	}

	result := path
	for name, schema := range pathParams {
		placeholder := "{" + name + "}"
		if strings.Contains(result, placeholder) {
			val := capPathParam(gen.Generate(name, schema))
			result = strings.ReplaceAll(result, placeholder, url.PathEscape(val))
		}
	}

	// Handle any remaining {param} not in pathParams
	for {
		start := strings.IndexByte(result, '{')
		if start < 0 {
			break
		}
		end := strings.IndexByte(result[start:], '}')
		if end < 0 {
			break
		}
		fallbackSchema := &swagger.SchemaProperty{Type: "string"}
		val := capPathParam(gen.Generate("id", fallbackSchema))
		result = result[:start] + url.PathEscape(val) + result[start+end+1:]
	}

	return result
}

// capPathParam ensures a path parameter value is safe to embed in a URL segment.
// Practical limit: ~256 chars — beyond that the value doesn't add testing value
// and breaks URL parsers / logging infrastructure.
func capPathParam(v any) string {
	s := fmt.Sprintf("%v", v)
	const maxPathParamLen = 256
	if len(s) > maxPathParamLen {
		return s[:maxPathParamLen]
	}
	return s
}

func mergePayload(payload any, queryParams map[string]any) any {
	if payload != nil {
		return payload
	}
	return queryParams
}

func copyMapIntInt64(src map[int]int64) map[int]int64 {
	if src == nil {
		return nil
	}
	dst := make(map[int]int64, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func copyMapProfileInt64(src map[swagger.FuzzingProfile]int64) map[swagger.FuzzingProfile]int64 {
	if src == nil {
		return nil
	}
	dst := make(map[swagger.FuzzingProfile]int64, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func copyMapEndpoint(src map[string]map[int]int64) map[string]map[int]int64 {
	if src == nil {
		return nil
	}
	dst := make(map[string]map[int]int64, len(src))
	for k, v := range src {
		dst[k] = copyMapIntInt64(v)
	}
	return dst
}

func copyMapStatusByProfile(src map[swagger.FuzzingProfile]map[int]int64) map[swagger.FuzzingProfile]map[int]int64 {
	if src == nil {
		return nil
	}
	dst := make(map[swagger.FuzzingProfile]map[int]int64, len(src))
	for k, v := range src {
		dst[k] = copyMapIntInt64(v)
	}
	return dst
}

// toSSE converts a full FuzzResult into the lightweight FuzzResultSSE for SSE broadcast.
// Raw payload and responseBody are replaced by short preview strings (≤200 chars).
// ResolvedPath is capped to 200 chars to avoid megabyte URLs in the UI.
// This is the ONLY place payload content is summarised — it never reaches the browser as raw data.
func toSSE(r *swagger.FuzzResult) *swagger.FuzzResultSSE {
	resolvedPath := r.ResolvedPath
	if len(resolvedPath) > 200 {
		resolvedPath = resolvedPath[:200] + "…"
	}
	return &swagger.FuzzResultSSE{
		ID:              r.ID,
		Endpoint:        r.Endpoint,
		ResolvedPath:    resolvedPath,
		Method:          r.Method,
		Profile:         r.Profile,
		Status:          r.Status,
		Duration:        r.Duration,
		PayloadSize:     r.PayloadSize,
		PayloadPreview:  previewAny(r.Payload, 200),
		ResponsePreview: previewAny(r.ResponseBody, 1024),
		Error:           r.Error,
		Timestamp:       r.Timestamp,
		Retries:         r.Retries,
	}
}

// previewAny serialises any value into a short human-readable string capped at maxLen bytes.
func previewAny(v any, maxLen int) string {
	if v == nil {
		return ""
	}
	var s string
	switch val := v.(type) {
	case string:
		s = val
	default:
		b, err := json.Marshal(val)
		if err != nil {
			return ""
		}
		s = string(b)
	}
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "…"
}
