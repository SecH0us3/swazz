// runner.go: Core execution engine for the swazz fuzzer.
// It orchestrates the fuzzing process across endpoints, profiles, and iterations,
// managing concurrency and the request-response lifecycle.

package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
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

	eventQueue *MPSCQueue
	doneCh     chan struct{}

	configMu    sync.RWMutex
	varReplacer *strings.Replacer

	pauseCond *sync.Cond
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
	r := &Runner{
		config:     config,
		client:     client,
		stats:      newEmptyStats(),
		subs:       make(map[chan Event]struct{}),
		eventQueue: NewMPSCQueue(),
		doneCh:     make(chan struct{}),
	}
	r.pauseCond = sync.NewCond(&r.mu)
	r.updateReplacer()
	go r.broadcastLoop()
	return r
}

// Close stops the background broadcast loop and cleans up resources.
func (r *Runner) Close() {
	r.mu.Lock()
	if r.cancel != nil {
		r.cancel()
	}
	r.mu.Unlock()
	close(r.doneCh)
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

		r.Broadcast(Event{Type: EventComplete, Data: r.GetStats()})
	}()

	profiles := r.getOrderedProfiles()
	r.calculateTotalPlanned(profiles)

	for profileIdx, profile := range profiles {
		if r.stopped() {
			break
		}

		r.mu.Lock()
		r.stats.Progress.CurrentProfile = string(profile)
		r.mu.Unlock()

		for epIdx, endpoint := range r.config.Endpoints {
			if r.stopped() {
				break
			}

			gen := generator.New(r.config.Dictionaries, profile, r.config.Settings)
			safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)

			r.fuzzEndpoint(ctx, profileIdx, profile, epIdx, endpoint, gen, safeGen)
		}
	}

	return nil
}

func (r *Runner) getOrderedProfiles() []swagger.FuzzingProfile {
	settings := r.config.Settings
	var lightProfiles, heavyList []swagger.FuzzingProfile
	for _, p := range settings.Profiles {
		if p == swagger.ProfileBoundary {
			heavyList = append(heavyList, p)
		} else {
			lightProfiles = append(lightProfiles, p)
		}
	}
	return append(lightProfiles, heavyList...)
}

func (r *Runner) calculateTotalPlanned(profiles []swagger.FuzzingProfile) {
	settings := r.config.Settings
	endpoints := r.config.Endpoints
	iterations := settings.IterationsPerProfile

	var totalPlanned int64
	for _, ep := range endpoints {
		hasF := hasFields(&ep)
		for _, p := range profiles {
			minNeeded := generator.MinIterationsNeeded(p, settings)
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
}

func (r *Runner) fuzzEndpoint(
	ctx context.Context,
	profileIdx int,
	profile swagger.FuzzingProfile,
	epIdx int,
	endpoint swagger.EndpointConfig,
	gen *generator.Generator,
	safeGen *generator.Generator,
) {
	settings := r.config.Settings
	endpoints := r.config.Endpoints
	epKey := fmt.Sprintf("%s %s", endpoint.Method, endpoint.Path)

	r.mu.Lock()
	r.stats.Progress.CurrentEndpoint = epKey
	r.stats.Progress.CompletedEndpoints = profileIdx*len(endpoints) + epIdx
	r.mu.Unlock()

	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	iterations := settings.IterationsPerProfile
	minNeeded := generator.MinIterationsNeeded(profile, settings)
	effectiveIterations := iterations
	if minNeeded > effectiveIterations {
		effectiveIterations = minNeeded
	}
	if !hasFields(&endpoint) {
		effectiveIterations = 1
	}

	defaultMaxPayloadSize := settings.MaxPayloadSizeBytes
	if defaultMaxPayloadSize <= 0 {
		defaultMaxPayloadSize = 1048576 // 1MB default
	}

	currentMaxPayloadSize := defaultMaxPayloadSize
	if profile == swagger.ProfileBoundary {
		if currentMaxPayloadSize < 536870912 {
			currentMaxPayloadSize = 536870912
		}
	}

	isBodyMethod := !isNoBodyMethod(endpoint.Method)
	sem := make(chan struct{}, settings.Concurrency)
	enableDedup := profile == swagger.ProfileRandom
	var wg sync.WaitGroup
	seenHashes := make(map[uint32]bool)
	delay := time.Duration(settings.DelayBetweenRequestMs) * time.Millisecond

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

		r.mu.Lock()
		for r.isPaused && !r.shouldStop {
			r.pauseCond.Wait()
		}
		if r.shouldStop {
			r.mu.Unlock()
			break
		}
		r.mu.Unlock()

		sem <- struct{}{}
		wg.Add(1)

		go func(it int, p any, qp map[string]any) {
			defer func() {
				<-sem
				wg.Done()
			}()

			resolvedPath := fillPathParams(endpoint.Path, endpoint.PathParams, safeGen)
			generatedHeaders := make(map[string]string)
			if len(endpoint.HeaderParams) > 0 {
				headerSchema := &swagger.SchemaProperty{
					Type:       "object",
					Properties: endpoint.HeaderParams,
				}
				headerObj := gen.BuildObject(headerSchema)
				for k, v := range headerObj {
					generatedHeaders[k] = fmt.Sprintf("%v", v)
				}
			}

			result := r.executeRequest(
				ctx,
				r.config.BaseURL,
				resolvedPath,
				endpoint.Path,
				endpoint.Method,
				r.config.GlobalHeaders,
				r.config.Cookies,
				p,
				profile,
				qp,
				generatedHeaders,
				endpoint.ContentType,
			)

			r.mu.Lock()
			r.stats.Progress.CurrentIteration = it + 1
			r.stats.Progress.TotalIterations = effectiveIterations
			r.mu.Unlock()

			r.updateStats(result)
			r.Broadcast(Event{Type: EventResult, Data: result})
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
		}(i, payload, queryParams)

		if delay > 0 {
			time.Sleep(delay)
		}
	}

	wg.Wait()

	r.mu.Lock()
	r.stats.Progress.CompletedEndpoints = profileIdx*len(endpoints) + epIdx + 1
	r.mu.Unlock()
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
}

// Stop signals the runner to stop.
func (r *Runner) Stop() {
	r.mu.Lock()
	r.shouldStop = true
	r.isPaused = false
	if r.cancel != nil {
		r.cancel()
	}
	r.pauseCond.Broadcast()
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
	r.pauseCond.Broadcast()
	r.mu.Unlock()
}

// IsRunning returns whether the runner is active.
func (r *Runner) IsRunning() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.isRunning
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
	// Merge headers: generatedHeaders < global headers
	isBody := !isNoBodyMethod(method)
	mergedHeaders := make(map[string]string)
	for k, v := range generatedHeaders {
		mergedHeaders[k] = v
	}

	r.configMu.RLock()
	for k, v := range headers {
		// Apply variable substitution to global headers too
		mergedHeaders[k] = r.subVarsLocked(v)
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

	rawURL := strings.TrimRight(baseURL, "/") + resolvedPath
	rawURL = r.subVarsLocked(rawURL)

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

	timeoutMs := r.config.Settings.TimeoutMs
	r.configMu.RUnlock()
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
			if bodyReader == nil && strings.Contains(effectiveCT, "xml") {
				if m, ok := payload.(map[string]any); ok {
					xmlContent, errXML := generator.ToXML(m, "request")
					if errXML != nil {
						reqCancel()
						return &swagger.FuzzResult{
							ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
							Method: method, Profile: profile, Status: 0, Payload: payload, PayloadSize: 0,
							Error: "failed to generate XML payload: " + errXML.Error(), Timestamp: time.Now().UnixMilli(), Retries: attempt,
						}
					}
					soapBody, errSOAP := generator.WrapInSOAP(xmlContent)
					if errSOAP != nil {
						reqCancel()
						return &swagger.FuzzResult{
							ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
							Method: method, Profile: profile, Status: 0, Payload: payload, PayloadSize: 0,
							Error: "failed to wrap SOAP payload: " + errSOAP.Error(), Timestamp: time.Now().UnixMilli(), Retries: attempt,
						}
					}
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
			for k, v := range cookies {
				req.AddCookie(&http.Cookie{Name: k, Value: v})
			}
		}

		if r.config.Settings.Debug {
			dump, _ := httputil.DumpRequestOut(req, true)
			fmt.Printf("\n--- [DEBUG] Fuzz Request ---\n%s\n----------------------------\n", string(dump))
		}

		start := time.Now()
		resp, err := r.client.Do(req)
		duration := time.Since(start).Milliseconds()
		reqCancel()

		if err == nil && r.config.Settings.Debug {
			dump, _ := httputil.DumpResponse(resp, false)
			fmt.Printf("\n--- [DEBUG] Fuzz Response ---\n%s\n-----------------------------\n", string(dump))
		}

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

		// Handle 429 with backoff
		if resp.StatusCode == 429 && attempt < maxRetriesOn429 {
			resp.Body.Close() // #nosec G104 -- error from Body.Close irrelevant after 429 backoff
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
			io.Copy(buf, io.LimitReader(resp.Body, 51200)) // #nosec G104 -- error intentionally ignored; buf.Len() check handles empty reads
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
			io.Copy(io.Discard, resp.Body) // #nosec G104 -- drain body for connection reuse, error irrelevant
		}
		resp.Body.Close() // #nosec G104 -- close error irrelevant after body fully consumed

		return &swagger.FuzzResult{
			ID: uuid.New().String(), Endpoint: originalPath, ResolvedPath: resolvedPath,
			Method: method, Profile: profile, Status: resp.StatusCode, Duration: duration,
			Payload: mergePayload(payload, queryParams), PayloadSize: payloadSize, ResponseBody: respBody,
			Timestamp: time.Now().UnixMilli(), Retries: attempt,
		}
	}
}
