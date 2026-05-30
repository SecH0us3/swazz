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
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/ratelimit"
	"swazz-engine/internal/security"
	"swazz-engine/internal/swagger"

	"github.com/google/uuid"
)

var uuidRegex = regexp.MustCompile(`[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`)

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
	sizeBaselines *sync.Map
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
		analyzer:      analyzer.NewRegistry(),
		sizeBaselines: &sync.Map{},
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
	r.sizeBaselines = &sync.Map{}

	// Clear the global OOB store to prevent memory leaks from stale UUIDs of previous runs
	oob.GlobalStore.Clear()

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

	if r.config.Settings.Debug {
		fmt.Printf("[DEBUG-START-RUN] len(endpoints)=%d, profiles=%v sizeBaselinesIsNil=%t\n",
			len(r.config.Endpoints), profiles, r.sizeBaselines == nil)
	}

	concurrency := r.config.Settings.Concurrency
	if concurrency <= 0 {
		concurrency = 5
	}
	if concurrency > 1000 {
		return fmt.Errorf("concurrency limit exceeded (max 1000)")
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	for _, endpoint := range r.config.Endpoints {
		if r.stopped() {
			break
		}
		key := fmt.Sprintf("%s %s", strings.ToUpper(endpoint.Method), endpoint.Path)
		if _, ok := r.sizeBaselines.Load(key); !ok {
			sem <- struct{}{}
			wg.Add(1)

			go func(ep swagger.EndpointConfig) {
				defer func() {
					<-sem
					wg.Done()
				}()

				safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
				safeGen.Endpoint = ep.Method + " " + ep.Path
				var payload any
				var qp map[string]any
				var gh map[string]string
				if hasFields(&ep) {
					generated := safeGen.BuildObject(&ep.Schema)
					isBody := !isNoBodyMethod(ep.Method)
					if isBody {
						payload = generated
					} else {
						qp = generated
					}
					if len(ep.HeaderParams) > 0 {
						gh = make(map[string]string)
						headerSchema := &swagger.SchemaProperty{
							Type:       "object",
							Properties: ep.HeaderParams,
						}
						headerObj := safeGen.BuildObject(headerSchema)
						for k, v := range headerObj {
							gh[k] = fmt.Sprintf("%v", v)
						}
					}
				}
				resolvedPath := fillPathParams(ep.Path, ep.PathParams, safeGen)
				result := r.executeRequest(
					ctx,
					r.config.BaseURL,
					resolvedPath,
					ep.Path,
					ep.Method,
					r.config.GlobalHeaders,
					r.config.Cookies,
					payload,
					swagger.ProfileRandom,
					qp,
					gh,
					ep.ContentType,
				)
				if r.config.Settings.Debug {
					fmt.Printf("[DEBUG-BASELINE-RUN] method=%s path=%s status=%d size=%d err=%v\n",
						ep.Method, ep.Path, result.Status, result.ResponseSize, result.Error)
				}
				if result.Status >= 200 && result.Status < 300 {
					r.recordSizeBaseline(ep.Method, ep.Path, result.ResponseSize)
				}
			}(endpoint)
		}
	}
	wg.Wait()

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
			endpointStr := endpoint.Method + " " + endpoint.Path
			gen.Endpoint = endpointStr
			safeGen.Endpoint = endpointStr

			r.fuzzEndpoint(ctx, profileIdx, profile, epIdx, endpoint, gen, safeGen)
		}
	}

	r.rateLimitPhase(ctx)

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
		if profile == swagger.ProfileMalicious {
			effectiveIterations = minNeeded
			if effectiveIterations < 1 {
				effectiveIterations = 1
			}
		} else {
			effectiveIterations = 1
		}
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
	concurrency := settings.Concurrency
	if concurrency <= 0 {
		concurrency = 5
	}
	if concurrency > 1000 {
		return
	}
	sem := make(chan struct{}, concurrency)

	enableDedup := profile == swagger.ProfileRandom
	var wg sync.WaitGroup
	seenHashes := make(map[uint32]bool)
	delay := time.Duration(settings.DelayBetweenRequestMs) * time.Millisecond

	for i := 0; i < effectiveIterations; i++ {
		if r.stopped() {
			break
		}

		// Determine if this is a security header fuzzing iteration.
		// During header fuzzing, we send valid/safe body payloads to bypass
		// application structure checks and isolate header-level vulnerabilities.
		isSecHeaderIter := false
		if profile == swagger.ProfileMalicious {
			bodyIters := gen.BodyIterations()
			if i >= bodyIters {
				isSecHeaderIter = true
			}
		}

		var payload any
		var queryParams map[string]any
		var payloadHash uint32 = payloads.HashStr("empty")
		isDuplicate := false

		if hasFields(&endpoint) {
			for retries := 0; retries < 10; retries++ {
				var generated map[string]any
				if isSecHeaderIter {
					generated = safeGen.BuildObject(&endpoint.Schema)
				} else {
					generated = gen.BuildObject(&endpoint.Schema)
				}

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

		// Generate fuzzed/safe headers sequentially in the main thread to prevent concurrency data races
		generatedHeaders := make(map[string]string)
		if len(endpoint.HeaderParams) > 0 {
			var headerGen *generator.Generator
			if isSecHeaderIter {
				headerGen = safeGen
			} else {
				headerGen = gen
			}
			headerSchema := &swagger.SchemaProperty{
				Type:       "object",
				Properties: endpoint.HeaderParams,
			}
			headerObj := headerGen.BuildObject(headerSchema)
			for k, v := range headerObj {
				generatedHeaders[k] = fmt.Sprintf("%v", v)
			}
		}

		// Inject custom security-test headers if this is a header fuzzing iteration
		if isSecHeaderIter {
			if secHeaders := gen.GenerateSecurityHeaders(); secHeaders != nil {
				for k, v := range secHeaders {
					generatedHeaders[k] = v
				}
			}
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

		go func(it int, p any, qp map[string]any, gh map[string]string) {
			defer func() {
				<-sem
				wg.Done()
			}()

			resolvedPath := fillPathParams(endpoint.Path, endpoint.PathParams, safeGen)

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
				gh,
				endpoint.ContentType,
			)

			if profile == swagger.ProfileRandom && result.Status >= 200 && result.Status < 300 {
				r.recordSizeBaseline(endpoint.Method, endpoint.Path, result.ResponseSize)
			}

			// Send result to aggregator (buffered, non-blocking under normal load).
			r.statsChan <- statsMsg{
				result:           result,
				currentIteration: it + 1,
				totalIterations:  effectiveIterations,
			}
			// Broadcast individual result immediately (lock-free MPSCQueue).
			r.Broadcast(Event{Type: EventResult, Data: result})
		}(i, payload, queryParams, generatedHeaders)

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

		// Look for OOB payloads to register the actual request details
		if profile == swagger.ProfileMalicious {
			if dump, err := httputil.DumpRequestOut(req, true); err == nil {
				reqStr := string(dump)
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

		start := time.Now()
		resp, err := r.client.Do(req)
		duration := time.Since(start).Milliseconds()

		if err == nil && r.config.Settings.Debug {
			dump, _ := httputil.DumpResponse(resp, false)
			fmt.Printf("\n--- [DEBUG] Fuzz Response ---\n%s\n-----------------------------\n", string(dump))
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
		reqCancel()

		responseSize := resp.ContentLength
		if responseSize < 0 {
			responseSize = int64(len(rawBodyBytes)) + discarded
		}
		if r.config.Settings.Debug && originalPath == "/users" {
			fmt.Printf("[DEBUG-USERS-RESPONSE] status=%d ContentLength=%d len(rawBodyBytes)=%d discarded=%d AnalyzeResponseBody=%t\n",
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
			Retries:         attempt,
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
			}
			result.AnalyzerFindings = r.analyzer.Analyze(input)
			if r.config.Settings.Debug && len(result.AnalyzerFindings) > 0 {
				fmt.Printf("[DEBUG-ANALYZER] Found findings for %s %s: %v\n", method, originalPath, result.AnalyzerFindings)
			}
			if r.config.Settings.Debug && profile == swagger.ProfileMalicious && originalPath == "/users" {
				fmt.Printf("[DEBUG-USERS-ANOMALY] method=%s baseline=%d observed=%d mult=%.1f findings=%d payload=%v\n",
					method, baselineSize, responseSize, multiplier, len(result.AnalyzerFindings), result.Payload)
			}
		}

		return result
	}
}

type EndpointSizeBaseline struct {
	mu         sync.Mutex
	sizes      []int64
	medianSize int64
	calculated bool
}

func (b *EndpointSizeBaseline) addSize(size int64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.sizes = append(b.sizes, size)
	b.calculated = false
}

func (b *EndpointSizeBaseline) getMedian() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.calculated {
		return b.medianSize
	}
	n := len(b.sizes)
	if n == 0 {
		b.medianSize = 0
		b.calculated = true
		return 0
	}

	temp := make([]int64, n)
	copy(temp, b.sizes)
	sort.Slice(temp, func(i, j int) bool { return temp[i] < temp[j] })

	if n%2 == 1 {
		b.medianSize = temp[n/2]
	} else {
		b.medianSize = (temp[n/2-1] + temp[n/2]) / 2
	}
	b.calculated = true
	return b.medianSize
}

func (r *Runner) recordSizeBaseline(method, path string, size int64) {
	key := fmt.Sprintf("%s %s", strings.ToUpper(method), path)
	val, ok := r.sizeBaselines.Load(key)
	if !ok {
		val, _ = r.sizeBaselines.LoadOrStore(key, &EndpointSizeBaseline{})
	}
	baseline := val.(*EndpointSizeBaseline)
	baseline.addSize(size)
}

func (r *Runner) getSizeBaselineMedian(method, path string) int64 {
	key := fmt.Sprintf("%s %s", strings.ToUpper(method), path)
	val, ok := r.sizeBaselines.Load(key)
	if !ok {
		return 0
	}
	return val.(*EndpointSizeBaseline).getMedian()
}

func (r *Runner) rateLimitPhase(ctx context.Context) {
	r.configMu.RLock()
	checkEnabled := r.config.Settings.RateLimitCheck
	burstSize := r.config.Settings.RateLimitBurstSize
	timeoutMs := r.config.Settings.TimeoutMs
	r.configMu.RUnlock()

	if !checkEnabled {
		return
	}

	r.currentProfile.Store("RATE-LIMIT")

	for _, endpoint := range r.config.Endpoints {
		if r.stopped() {
			break
		}

		epKey := fmt.Sprintf("%s %s", endpoint.Method, endpoint.Path)
		r.currentEndpoint.Store(epKey)
		r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

		safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
		safeGen.Endpoint = endpoint.Method + " " + endpoint.Path

		var payload any
		var queryParams map[string]any
		var generatedHeaders map[string]string

		if hasFields(&endpoint) {
			generated := safeGen.BuildObject(&endpoint.Schema)
			isBody := !isNoBodyMethod(endpoint.Method)
			if isBody {
				payload = generated
			} else {
				queryParams = generated
			}
			if len(endpoint.HeaderParams) > 0 {
				generatedHeaders = make(map[string]string)
				headerSchema := &swagger.SchemaProperty{
					Type:       "object",
					Properties: endpoint.HeaderParams,
				}
				headerObj := safeGen.BuildObject(headerSchema)
				for k, v := range headerObj {
					generatedHeaders[k] = fmt.Sprintf("%v", v)
				}
			}
		}

		resolvedPath := fillPathParams(endpoint.Path, endpoint.PathParams, safeGen)

		// Merge headers: generatedHeaders < global headers
		mergedHeaders := make(map[string]string)
		for k, v := range generatedHeaders {
			mergedHeaders[k] = v
		}
		r.configMu.RLock()
		for k, v := range r.config.GlobalHeaders {
			mergedHeaders[k] = r.subVarsLocked(v)
		}
		r.configMu.RUnlock()

		finding, statusCodes := ratelimit.Check(
			ctx,
			r.client,
			r.config.BaseURL,
			resolvedPath,
			endpoint.Path,
			endpoint.Method,
			mergedHeaders,
			payload,
			queryParams,
			endpoint.ContentType,
			burstSize,
			timeoutMs,
		)

		// Record the burst results in stats
		for i, status := range statusCodes {
			if status == 0 {
				continue
			}
			r.statsChan <- statsMsg{
				result: &swagger.FuzzResult{
					ID:           uuid.New().String(),
					Endpoint:     endpoint.Path,
					ResolvedPath: resolvedPath,
					Method:       endpoint.Method,
					Profile:      swagger.FuzzingProfile("RATE-LIMIT"),
					Status:       status,
					Timestamp:    time.Now().UnixMilli(),
				},
				currentIteration: i + 1,
				totalIterations:  len(statusCodes),
			}
		}

		if finding != nil {
			evidenceStr := fmt.Sprintf("%v", finding.ResponseBody)
			result := &swagger.FuzzResult{
				ID:           uuid.New().String(),
				Endpoint:     endpoint.Path,
				ResolvedPath: resolvedPath,
				Method:       endpoint.Method,
				Profile:      swagger.FuzzingProfile("RATE-LIMIT"),
				Status:       finding.Status,
				Duration:     finding.Duration,
				Payload:      nil,
				Timestamp:    finding.Timestamp,
				ResponseBody: evidenceStr,
				AnalyzerFindings: []swagger.AnalysisFinding{
					{
						RuleID:   finding.RuleID,
						Level:    string(finding.Level),
						Message:  evidenceStr,
						Evidence: evidenceStr,
					},
				},
			}
			r.Broadcast(Event{Type: EventResult, Data: result})
		}
	}
}


