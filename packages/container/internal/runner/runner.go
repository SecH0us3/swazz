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

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/security"
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

	// Control-flow flags — atomic, zero-lock reads from hot path.
	isRunning  atomic.Bool
	isPaused   atomic.Bool
	shouldStop atomic.Bool

	// Lifecycle guard — only for Start/Stop/Close state transitions.
	lifecycleMu sync.Mutex
	cancel      context.CancelFunc

	// Stats aggregation — channel-based, owned by statsAggregator goroutine.
	statsChan   chan statsMsg
	latestStats atomic.Pointer[swagger.RunStats]
	statsDone   chan struct{}

	// Progress metadata — written by main loop (single writer), read by aggregator.
	currentEndpoint    atomic.Value // string
	currentProfile     atomic.Value // string
	completedEndpoints atomic.Int32
	totalEndpoints     atomic.Int32
	totalPlanned       atomic.Int64

	// SSE subscribers
	subsMu sync.RWMutex
	subs   map[chan Event]struct{}

	eventQueue *MPSCQueue
	doneCh     chan struct{}

	configMu    sync.RWMutex
	varReplacer *strings.Replacer

	// Pause/resume — separate mutex, not on hot path.
	pauseMu   sync.Mutex
	pauseCond *sync.Cond

	analyzer *analyzer.AnalyzerRegistry
}

// New creates a new Runner.
func New(config *swagger.Config, client *http.Client) *Runner {
	if client == nil {
		client = &http.Client{
			Timeout: 30 * time.Second,
		}
	}
	client.Transport = security.WrapWithSSRFProtection(client.Transport, config.Security.AllowPrivateIPs)
	r := &Runner{
		config:     config,
		client:     client,
		subs:       make(map[chan Event]struct{}),
		eventQueue: NewMPSCQueue(),
		doneCh:     make(chan struct{}),
		statsChan:  make(chan statsMsg, 4096),
		statsDone:  make(chan struct{}),
		analyzer:   analyzer.NewRegistry(),
	}
	r.pauseCond = sync.NewCond(&r.pauseMu)
	r.updateReplacer()
	// Publish initial empty stats snapshot.
	empty := newEmptyStats()
	r.latestStats.Store(&empty)
	go r.broadcastLoop()
	return r
}

// Close stops the background broadcast loop and cleans up resources.
func (r *Runner) Close() {
	r.lifecycleMu.Lock()
	if r.cancel != nil {
		r.cancel()
	}
	r.lifecycleMu.Unlock()
	close(r.doneCh)
}

// Start begins the fuzzing run. Blocks until complete or stopped.
func (r *Runner) Start(ctx context.Context) error {
	r.lifecycleMu.Lock()
	if r.isRunning.Load() {
		r.lifecycleMu.Unlock()
		return fmt.Errorf("already running")
	}
	r.isRunning.Store(true)
	r.isPaused.Store(false)
	r.shouldStop.Store(false)

	// Re-create stats channel (may have been closed by a previous run).
	r.statsChan = make(chan statsMsg, 4096)
	r.statsDone = make(chan struct{})
	empty := newEmptyStats()
	r.latestStats.Store(&empty)

	ctx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.lifecycleMu.Unlock()

	// Launch the stats aggregator goroutine.
	go r.statsAggregator()

	defer func() {
		cancel()

		// Close the stats channel to signal aggregator shutdown,
		// then wait for it to drain and publish the final snapshot.
		close(r.statsChan)
		<-r.statsDone

		r.isRunning.Store(false)
		// Publish final snapshot with IsRunning=false.
		final := r.GetStats()
		final.IsRunning = false
		final.Progress.CurrentEndpoint = ""
		final.Progress.CurrentProfile = ""
		r.latestStats.Store(&final)
		r.Broadcast(Event{Type: EventComplete, Data: final})
	}()

	profiles := r.getOrderedProfiles()
	r.calculateTotalPlanned(profiles)

	for profileIdx, profile := range profiles {
		if r.stopped() {
			break
		}

		r.currentProfile.Store(string(profile))

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
	r.totalPlanned.Store(totalPlanned)
	r.totalEndpoints.Store(int32(len(endpoints) * len(profiles)))
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

	r.currentEndpoint.Store(epKey)
	r.completedEndpoints.Store(int32(profileIdx*len(endpoints) + epIdx))

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
			r.totalPlanned.Add(-1)
			continue
		}
		if enableDedup {
			seenHashes[payloadHash] = true
		}

		r.pauseMu.Lock()
		for r.isPaused.Load() && !r.shouldStop.Load() {
			r.pauseCond.Wait()
		}
		r.pauseMu.Unlock()
		if r.shouldStop.Load() {
			break
		}

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

			// Inject security-test headers for MALICIOUS profile.
			// These test for server misconfigurations (Host injection, CORS, IP spoofing, JWT).
			if secHeaders := gen.GenerateSecurityHeaders(); secHeaders != nil {
				for k, v := range secHeaders {
					generatedHeaders[k] = v
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

			// Send result to aggregator (buffered, non-blocking under normal load).
			r.statsChan <- statsMsg{
				result:           result,
				currentIteration: it + 1,
				totalIterations:  effectiveIterations,
			}
			// Broadcast individual result immediately (lock-free MPSCQueue).
			r.Broadcast(Event{Type: EventResult, Data: result})
		}(i, payload, queryParams)

		if delay > 0 {
			time.Sleep(delay)
		}
	}

	wg.Wait()

	r.completedEndpoints.Store(int32(profileIdx*len(endpoints) + epIdx + 1))
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
}

// Stop signals the runner to stop.
func (r *Runner) Stop() {
	r.shouldStop.Store(true)
	r.isPaused.Store(false)
	r.lifecycleMu.Lock()
	if r.cancel != nil {
		r.cancel()
	}
	r.lifecycleMu.Unlock()
	// Wake any goroutines waiting on pauseCond.
	r.pauseCond.Broadcast()
}

// Pause pauses the runner.
func (r *Runner) Pause() {
	if r.isRunning.Load() {
		r.isPaused.Store(true)
	}
}

// Resume resumes a paused runner.
func (r *Runner) Resume() {
	r.isPaused.Store(false)
	r.pauseCond.Broadcast()
}

// IsRunning returns whether the runner is active.
func (r *Runner) IsRunning() bool {
	return r.isRunning.Load()
}

// ─── Private ────────────────────────────────────────────

func (r *Runner) stopped() bool { return r.shouldStop.Load() }

func (r *Runner) paused() bool { return r.isPaused.Load() }

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
			} else {
				req.Header.Set(k, v)
			}
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
				RequestHeaders: mergedHeaders,
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
					RequestHeaders: mergedHeaders,
				}
			}
		}

		var respBody any
		var rawBodyBytes []byte
		if resp.StatusCode >= 400 || r.config.Settings.AnalyzeResponseBody {
			buf := bufPool.Get().(*bytes.Buffer)
			buf.Reset()
			io.Copy(buf, io.LimitReader(resp.Body, 51200)) // #nosec G104 -- error intentionally ignored; buf.Len() check handles empty reads
			if buf.Len() > 0 {
				rawBodyBytes = make([]byte, buf.Len())
				copy(rawBodyBytes, buf.Bytes())
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
		resp.Body.Close() // #nosec G104 -- close error irrelevant after body fully consumed

		responseSize := resp.ContentLength
		if responseSize < 0 {
			responseSize = int64(len(rawBodyBytes)) + discarded
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
			Retries:         attempt,
		}

		if r.config.Settings.AnalyzeResponseBody && len(rawBodyBytes) > 0 {
			input := &analyzer.AnalysisInput{
				SentPayload:     result.Payload,
				ResponseBody:    rawBodyBytes,
				ResponseHeaders: resp.Header,
				Duration:        duration,
				Profile:         profile,
				Endpoint:        originalPath,
				Method:          method,
			}
			result.AnalyzerFindings = r.analyzer.Analyze(input)
		}

		return result
	}
}
