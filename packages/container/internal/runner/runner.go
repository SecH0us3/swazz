// runner.go: Core execution engine for the swazz fuzzer.
//
// # Execution Phases
//
//  1. Baseline phase   — one safe request per endpoint to record size/time baselines.
//  2. Fuzzing phases   — N iterations × M profiles, concurrent goroutine dispatch.
//  3. BOLA phase       — replays harvested IDs with alternate identities.
//  4. Rate-limit phase — burst-probe each endpoint for rate-limit enforcement.
//
// # Concurrency Model (summary — see doc.go for the full picture)
//
// The struct is divided into embedded sub-structs that group related
// synchronisation primitives together, making lock ownership obvious at a
// glance.  The hot path (per-iteration loop) only touches atomic flags
// (runnerLifecycle / runnerProgress); heavier mutex work is in runnerPause
// and the per-field mutexes that own their own data.

package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"swazz-engine/internal/ai"
	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/security"
	"swazz-engine/internal/sstistore"
	"swazz-engine/internal/swagger"
)

var uuidRegex = regexp.MustCompile(`[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`)

var scanDurationUnit = time.Minute

const (
	maxRetriesOn429  = 3
	defaultBackoffMs = 2000

	defaultMaxPayloadBytes  = 1 << 20 // 1 MiB
	boundaryMaxPayloadBytes = 1 << 29 // 512 MiB
)

func (r *Runner) Config() *swagger.Config {
	return r.config
}

// ─── embedded sub-structs ────────────────────────────────────────────────────

// runnerLifecycle groups the atomic control-flow flags and the lifecycle mutex.
// All flag reads on the hot path are zero-lock; Start/Stop/Close are the only
// callers that need the mutex.
type runnerLifecycle struct {
	isRunning  atomic.Bool
	isPaused   atomic.Bool
	shouldStop atomic.Bool

	mu     sync.Mutex // guards cancel only
	cancel context.CancelFunc
}

// runnerProgress groups the atomic progress counters written by the main loop
// and read by the stats aggregator goroutine.
type runnerProgress struct {
	currentEndpoint    atomic.Value // string
	currentProfile     atomic.Value // string
	completedEndpoints atomic.Int32
	totalEndpoints     atomic.Int32
	totalPlanned       atomic.Int64
	totalRequests      atomic.Int64
}

// runnerPause groups the pause/resume condvar, intentionally separate from
// the lifecycle mutex to avoid priority inversion between the hot iteration
// path and Start/Stop state transitions.
type runnerPause struct {
	mu   sync.Mutex
	cond *sync.Cond
}

// ─── Runner ──────────────────────────────────────────────────────────────────

// Runner orchestrates fuzzing runs across endpoints × profiles × iterations.
type Runner struct {
	config *swagger.Config
	client *http.Client

	lifecycle runnerLifecycle
	progress  runnerProgress
	pause     runnerPause

	// Stats aggregation — channel-based, owned by statsAggregator goroutine.
	statsChan   chan statsMsg
	latestStats atomic.Pointer[swagger.RunStats]
	statsDone   chan struct{}

	// SSE event pipeline (lock-free MPSCQueue + RW-guarded subscriber set).
	subsMu     sync.RWMutex
	subs       map[chan Event]struct{}
	eventQueue *MPSCQueue
	doneCh     chan struct{}

	// Config variable substitution — written once per config reload.
	configMu    sync.RWMutex
	varReplacer *strings.Replacer

	// Domain state & regex cache — used by chaining rules.
	stateMu       sync.RWMutex
	state         map[string]string
	stateReplacer *strings.Replacer
	regexCache    map[string]*regexp.Regexp
	regexCacheMu  sync.RWMutex

	// Auth & CSRF — protected by their own fine-grained mutexes.
	reauthMu        sync.Mutex
	csrfMu          sync.RWMutex
	activeCSRFToken string
	lastProbeTime   time.Time

	// Per-run baselines, results, and concurrency control.
	sizeBaselines *sync.Map
	timeBaselines *sync.Map
	harvestedIDs  sync.Map // path prefix → []string
	idSources     sync.Map // ID string → source string
	resultsMu     sync.Mutex
	allResults    []*swagger.FuzzResult
	limiter       *ConcurrencyLimiter

	analyzer *analyzer.AnalyzerRegistry

	mcpClient     mcp.Client
	mcpMutex      sync.Mutex
	mcpRateLimiter *mcp.RateLimiter
}

// New creates a new Runner with sensible defaults.
func New(config *swagger.Config, client *http.Client) *Runner {
	if config == nil {
		return nil
	}
	if client == nil {
		client = &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				Proxy: http.ProxyFromEnvironment,
				DialContext: (&net.Dialer{
					Timeout:   30 * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				ForceAttemptHTTP2:     true,
				TLSHandshakeTimeout:   10 * time.Second,
				ExpectContinueTimeout: 1 * time.Second,
			},
		}
		security.ConfigureTransport(client.Transport.(*http.Transport))
	} else if client.Transport == nil {
		clonedClient := *client
		clonedClient.Transport = &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   30 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			ForceAttemptHTTP2:     true,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		}
		security.ConfigureTransport(clonedClient.Transport.(*http.Transport))
		client = &clonedClient
	} else if transport, ok := client.Transport.(*http.Transport); ok {
		clonedClient := *client
		clonedTransport := transport.Clone()
		security.ConfigureTransport(clonedTransport)
		clonedClient.Transport = clonedTransport
		client = &clonedClient
	}
	client.Transport = security.WrapWithSSRFProtection(client.Transport, config.Security.AllowPrivateIPs)

	r := &Runner{
		config:        config,
		client:        client,
		subs:          make(map[chan Event]struct{}),
		eventQueue:    NewMPSCQueue(),
		doneCh:        make(chan struct{}),
		statsChan:     make(chan statsMsg, 4096),
		statsDone:     make(chan struct{}),
		analyzer:      analyzer.NewRegistry(),
		sizeBaselines: &sync.Map{},
		timeBaselines: &sync.Map{},
		state:         make(map[string]string),
		regexCache:    make(map[string]*regexp.Regexp),
	}
	if config.MCPServer != nil {
		mcpHeaders := make(map[string]string)
		for k, v := range config.GlobalHeaders {
			mcpHeaders[k] = v
		}
		if len(config.Cookies) > 0 {
			var cookieParts []string
			for k, v := range config.Cookies {
				cookieParts = append(cookieParts, fmt.Sprintf("%s=%s", k, v))
			}
			mcpHeaders["Cookie"] = strings.Join(cookieParts, "; ")
		}

		if config.MCPServer.Type == "stdio" {
			r.mcpClient = mcp.NewStdioClient(config.MCPServer.Command, config.MCPServer.Args)
		} else if config.MCPServer.Type == "sse" {
			r.mcpClient = mcp.NewSSEClient(config.MCPServer.URL, config.Security.AllowPrivateIPs, mcpHeaders, nil)
		} else if config.MCPServer.Type == "http" {
			r.mcpClient = mcp.NewHTTPClient(config.MCPServer.URL, config.Security.AllowPrivateIPs, mcpHeaders)
		}
	}
	r.limiter = NewConcurrencyLimiter(config.Settings.Concurrency)
	r.pause.cond = sync.NewCond(&r.pause.mu)
	r.updateReplacer()

	empty := newEmptyStats()
	r.latestStats.Store(&empty)
	go r.broadcastLoop()
	return r
}

// Close stops the background broadcast loop and cancels any active run.
func (r *Runner) Close() {
	r.lifecycle.mu.Lock()
	if r.lifecycle.cancel != nil {
		r.lifecycle.cancel()
	}
	r.lifecycle.mu.Unlock()
	close(r.doneCh)
	if r.client != nil {
		r.client.CloseIdleConnections()
	}
}

// Start begins the fuzzing run. It blocks until the run completes or is stopped.
// Returns an error only when a run is already in progress.
func (r *Runner) Start(ctx context.Context) error {
	runCtx, err := r.initRun(ctx)
	if err != nil {
		return err
	}

	defer r.finaliseRun()

	if r.config.Settings.MaxScanDurationMin > 0 {
		timerCtx, cancelTimer := context.WithCancel(runCtx)
		defer cancelTimer()
		go func() {
			timer := time.NewTimer(time.Duration(r.config.Settings.MaxScanDurationMin) * scanDurationUnit)
			defer timer.Stop()
			select {
			case <-timer.C:
				r.logDebug("Scan exceeded maximum duration of %d minutes. Stopping...", r.config.Settings.MaxScanDurationMin)
				r.Stop()
			case <-timerCtx.Done():
			}
		}()
	}

	r.runPreScanLLM(runCtx)

	profiles := r.getOrderedProfiles()
	r.calculateTotalPlanned(profiles)

	r.logDebug("Start run: len(endpoints)=%d, profiles=%v sizeBaselinesIsNil=%t",
		len(r.config.Endpoints), profiles, r.sizeBaselines == nil)

	r.limiter.SetTarget(r.config.Settings.Concurrency)

	resumeProfile := ""
	resumeEndpoint := ""
	resumeIteration := 0
	resuming := false

	if r.config.Settings.Checkpoint != nil {
		// Defensively validate that the checkpoint's profile and endpoint exist in current config
		profileExists := false
		for _, p := range profiles {
			if string(p) == r.config.Settings.Checkpoint.Profile {
				profileExists = true
				break
			}
		}
		endpointExists := false
		for _, ep := range r.config.Endpoints {
			epKey := ep.Method + " " + ep.Path
			if epKey == r.config.Settings.Checkpoint.Endpoint {
				endpointExists = true
				break
			}
		}

		if profileExists && endpointExists {
			resumeProfile = r.config.Settings.Checkpoint.Profile
			resumeEndpoint = r.config.Settings.Checkpoint.Endpoint
			resumeIteration = r.config.Settings.Checkpoint.Iteration
			resuming = true
			r.lifecycle.isPaused.Store(r.config.Settings.Checkpoint.Paused)
		} else {
			r.logDebug("Checkpoint profile or endpoint not found in current configuration. Starting from beginning. Checkpoint: %+v", r.config.Settings.Checkpoint)
		}
	}

	var skippedRequests int64 = 0
	if resuming {
		for _, profile := range profiles {
			if string(profile) != resumeProfile {
				for _, endpoint := range r.config.Endpoints {
					skippedRequests += int64(endpointRequests(profile, r.config.Settings, &endpoint))
				}
				continue
			}
			for _, endpoint := range r.config.Endpoints {
				epKey := endpoint.Method + " " + endpoint.Path
				if epKey != resumeEndpoint {
					skippedRequests += int64(endpointRequests(profile, r.config.Settings, &endpoint))
					continue
				}
				skippedRequests += int64(resumeIteration)
				break
			}
			break
		}
		r.progress.totalRequests.Store(skippedRequests)
	}

	if !resuming {
		r.baselinePhase(runCtx)
	} else {
		// #nosec G115 -- Number of endpoints will never exceed int32 max
		r.progress.completedEndpoints.Store(int32(len(r.config.Endpoints)))
	}

	for profileIdx, profile := range profiles {
		if r.stopped() {
			break
		}

		if resuming && string(profile) != resumeProfile {
			// #nosec G115 -- Number of endpoints will never exceed int32 max
			r.progress.completedEndpoints.Add(int32(len(r.config.Endpoints)))
			continue
		}

		r.progress.currentProfile.Store(string(profile))

		for epIdx, endpoint := range r.config.Endpoints {
			if r.stopped() {
				break
			}

			if resuming {
				epKey := endpoint.Method + " " + endpoint.Path
				if epKey != resumeEndpoint {
					r.progress.completedEndpoints.Add(1)
					continue
				}
			}

			gen := generator.New(r.config.Dictionaries, profile, r.config.Settings)
			safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
			gen.RunID = r.config.RunID
			safeGen.RunID = r.config.RunID
			epStr := endpoint.Method + " " + endpoint.Path
			gen.Endpoint = epStr
			safeGen.Endpoint = epStr

			iterToSkip := 0
			if resuming {
				iterToSkip = resumeIteration
				resuming = false
			}

			r.fuzzEndpoint(runCtx, profileIdx, profile, epIdx, endpoint, gen, safeGen, iterToSkip)
		}
	}

	r.resultsMu.Lock()
	candidates := make([]*swagger.FuzzResult, len(r.allResults))
	copy(candidates, r.allResults)
	r.resultsMu.Unlock()

	_ = r.bolaPhase(runCtx, candidates)
	r.rateLimitPhase(runCtx)

	// Wait a brief grace period for any late OOB network interactions to complete
	if !r.stopped() && oob.GlobalStore.Size() > 0 {
		logger.Info("Waiting a 5-second grace period for pending OOB interactions...")
		select {
		case <-runCtx.Done():
		case <-time.After(5 * time.Second):
		}
	}

	return nil
}

// Stop signals the runner to halt after the current request completes.
func (r *Runner) Stop() {
	r.lifecycle.shouldStop.Store(true)
	r.lifecycle.isPaused.Store(false)
	r.lifecycle.mu.Lock()
	if r.lifecycle.cancel != nil {
		r.lifecycle.cancel()
	}
	r.lifecycle.mu.Unlock()
	r.pause.cond.Broadcast()
}

// Pause temporarily suspends dispatching new requests.
func (r *Runner) Pause() {
	if r.lifecycle.isRunning.Load() {
		r.lifecycle.isPaused.Store(true)
	}
}

// Resume resumes a paused runner.
func (r *Runner) Resume() {
	r.lifecycle.isPaused.Store(false)
	r.pause.cond.Broadcast()
}

// IsRunning reports whether the runner is currently executing a fuzz run.
func (r *Runner) IsRunning() bool { return r.lifecycle.isRunning.Load() }

// ─── Phases ──────────────────────────────────────────────────────────────────

// baselinePhase sends one safe request per endpoint that has not yet been
// baselined, recording size and latency medians for anomaly detection.
func (r *Runner) baselinePhase(ctx context.Context) {
	r.progress.currentProfile.Store("BASELINE")
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	var wg sync.WaitGroup

	for _, endpoint := range r.config.Endpoints {
		if r.stopped() {
			break
		}

		key := fmt.Sprintf("%s %s", strings.ToUpper(endpoint.Method), endpoint.Path)
		if _, alreadyDone := r.sizeBaselines.Load(key); alreadyDone {
			r.progress.completedEndpoints.Add(1)
			continue
		}

		if err := r.limiter.Acquire(ctx); err != nil {
			break
		}
		wg.Add(1)

		go func(ep swagger.EndpointConfig) {
			defer r.limiter.Release()
			defer wg.Done()

			epKey := ep.Method + " " + ep.Path
			r.progress.currentEndpoint.Store(epKey)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

			safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
			safeGen.RunID = r.config.RunID
			safeGen.Endpoint = epKey

			built := buildSafePayload(ep, safeGen)
			resolvedPath := fillPathParamsFromMap(ep.Path, built.pathParams)

			result := r.executeRequest(
				ctx,
				r.config.BaseURL, resolvedPath, ep.Path, ep.Method,
				r.config.GlobalHeaders, r.config.Cookies,
				built.body,
				swagger.FuzzingProfile("BASELINE"),
				built.queryParams,
				built.headers,
				ep.ContentType,
			)

			r.logDebug("Baseline run: method=%s path=%s status=%d size=%d err=%v",
				ep.Method, ep.Path, result.Status, result.ResponseSize, result.Error)

			if result.Status >= 200 && result.Status < 300 {
				r.recordSizeBaseline(ep.Method, ep.Path, result.ResponseSize)
				r.recordTimeBaseline(ep.Method, ep.Path, result.Duration)
			}

			r.statsChan <- statsMsg{
				result:           result,
				currentIteration: 1,
				totalIterations:  1,
				endpoint:         epKey,
				profile:          "BASELINE",
			}
			r.Broadcast(Event{Type: EventResult, Data: result})

			r.progress.completedEndpoints.Add(1)
			r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
		}(endpoint)
	}

	wg.Wait()
}

// fuzzEndpoint runs all iterations for a single endpoint × profile combination.
func (r *Runner) fuzzEndpoint(
	ctx context.Context,
	profileIdx int,
	profile swagger.FuzzingProfile,
	epIdx int,
	endpoint swagger.EndpointConfig,
	gen *generator.Generator,
	safeGen *generator.Generator,
	iterToSkip int,
) {
	endpoints := r.config.Endpoints
	epKey := fmt.Sprintf("%s %s", endpoint.Method, endpoint.Path)

	r.progress.currentEndpoint.Store(epKey)
	r.progress.completedEndpoints.Store(int32(len(endpoints) + profileIdx*len(endpoints) + epIdx)) // #nosec G115
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	if r.config.Settings.ActiveParameterFuzzing {
		fields := collectTargetFields(&endpoint)
		if len(fields) > 0 {
			r.runActiveParameterFuzzing(ctx, profileIdx, profile, epIdx, endpoint, gen, safeGen, fields, iterToSkip)
			return
		}
	}

	effectiveIter := calcEffectiveIterations(profile, r.config.Settings, &endpoint)
	maxPayload := calcMaxPayloadSize(profile, r.config.Settings)
	enableDedup := profile == swagger.ProfileRandom

	var wg sync.WaitGroup
	seenHashes := make(map[uint32]bool)
	delay := time.Duration(r.config.Settings.DelayBetweenRequestMs) * time.Millisecond

	for i := range effectiveIter {
		if i < iterToSkip {
			continue
		}
		if r.stopped() {
			break
		}

		isSecHeaderIter := isSecurityHeaderIteration(gen, profile, i)
		built, payloadHash, isDuplicate := r.buildFuzzIteration(
			endpoint, gen, safeGen, isSecHeaderIter, maxPayload, enableDedup, seenHashes,
		)
		if isDuplicate {
			r.progress.totalPlanned.Add(-1)
			continue
		}
		if enableDedup {
			seenHashes[payloadHash] = true
		}

		// Inject security-test headers if we are in a header-fuzzing iteration.
		if isSecHeaderIter {
			if secHeaders := gen.GenerateSecurityHeaders(); secHeaders != nil {
				if built.headers == nil {
					built.headers = make(map[string]string, len(secHeaders))
				}
				for k, v := range secHeaders {
					built.headers[k] = v
				}
			}
		}

		r.waitIfPaused()
		if r.stopped() {
			break
		}

		if err := r.limiter.Acquire(ctx); err != nil {
			break
		}
		wg.Add(1)

		go func(it int, p any, qp map[string]any, gh map[string]string, pp map[string]string) {
			defer r.limiter.Release()
			defer wg.Done()

			resolvedPath := fillPathParamsFromMap(endpoint.Path, pp)
			result := r.executeRequest(
				ctx,
				r.config.BaseURL, resolvedPath, endpoint.Path, endpoint.Method,
				r.config.GlobalHeaders, r.config.Cookies,
				p, profile, qp, gh,
				endpoint.ContentType,
			)

			if profile == swagger.ProfileRandom && result.Status >= 200 && result.Status < 300 {
				r.recordSizeBaseline(endpoint.Method, endpoint.Path, result.ResponseSize)
				r.recordTimeBaseline(endpoint.Method, endpoint.Path, result.Duration)
			}

			r.statsChan <- statsMsg{
				result:           result,
				currentIteration: it + 1,
				totalIterations:  effectiveIter,
				endpoint:         epKey,
				profile:          string(profile),
			}
			r.Broadcast(Event{Type: EventResult, Data: result})

			if result.Status >= 200 && result.Status < 300 {
				r.resultsMu.Lock()
				r.allResults = append(r.allResults, result)
				r.resultsMu.Unlock()
			}
		}(i, built.body, built.queryParams, built.headers, built.pathParams)

		if delay > 0 {
			time.Sleep(delay)
		}
	}

	wg.Wait()

	r.progress.completedEndpoints.Store(int32(len(endpoints) + profileIdx*len(endpoints) + epIdx + 1)) // #nosec G115
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
}

// ─── Iteration helpers ────────────────────────────────────────────────────────

// buildFuzzIteration generates one payload attempt, enforces the size cap and
// dedup check, and returns the result along with its hash and whether it was a
// duplicate. The caller owns the outer retry loop via effectiveIter.
func (r *Runner) buildFuzzIteration(
	endpoint swagger.EndpointConfig,
	gen, safeGen *generator.Generator,
	isSecHeaderIter bool,
	maxPayloadSize int,
	enableDedup bool,
	seenHashes map[uint32]bool,
) (built generatedPayload, hash uint32, duplicate bool) {
	const maxRetries = 10
	hash = payloads.HashStr("empty")

	if !hasFields(&endpoint) {
		// No fields to generate — only headers differ per iteration.
		built = generatedPayload{headers: buildHeaders(endpoint, selectGen(gen, safeGen, isSecHeaderIter))}
		if enableDedup {
			duplicate = seenHashes[hash]
		}
		return built, hash, duplicate
	}

	for range maxRetries {
		attempt := buildFuzzPayload(endpoint, gen, safeGen, isSecHeaderIter, enableDedup)

		// Size check via buffer pool.
		buf := bufPool.Get().(*bytes.Buffer)
		buf.Reset()
		var encErr error
		payloadMap := make(map[string]any)
		if attempt.body != nil {
			payloadMap["body"] = attempt.body
		}
		if attempt.queryParams != nil {
			payloadMap["queryParams"] = attempt.queryParams
		}
		if attempt.pathParams != nil {
			payloadMap["pathParams"] = attempt.pathParams
		}
		if len(payloadMap) > 0 {
			encErr = json.NewEncoder(buf).Encode(payloadMap)
		} else {
			buf.WriteByte('{')
			buf.WriteByte('}')
		}

		if encErr != nil || buf.Len() > maxPayloadSize {
			bufPool.Put(buf)
			continue
		}

		payloadStr := strings.TrimSuffix(buf.String(), "\n")
		hash = payloads.HashStr(payloadStr)
		bufPool.Put(buf)

		if enableDedup && seenHashes[hash] {
			continue
		}

		return attempt, hash, false
	}

	// All retries exhausted — treat as duplicate to skip.
	return generatedPayload{}, hash, true
}

// isSecurityHeaderIteration reports whether iteration i should use a safe
// body payload and inject security-test headers instead of fuzzing the body.
func isSecurityHeaderIteration(gen *generator.Generator, profile swagger.FuzzingProfile, i int) bool {
	if profile != swagger.ProfileMalicious {
		return false
	}
	return i >= gen.BodyIterations()
}

// waitIfPaused blocks the calling goroutine until the runner is resumed or
// stopped. It must only be called from the main iteration loop (single writer).
func (r *Runner) waitIfPaused() {
	r.pause.mu.Lock()
	for r.lifecycle.isPaused.Load() && !r.lifecycle.shouldStop.Load() {
		r.pause.cond.Wait()
	}
	r.pause.mu.Unlock()
}

// ─── Profile / iteration helpers ─────────────────────────────────────────────

// getOrderedProfiles returns configured profiles with boundary testing last,
// ensuring cheap profiles run first so results arrive early.
func (r *Runner) getOrderedProfiles() []swagger.FuzzingProfile {
	var light, heavy []swagger.FuzzingProfile
	for _, p := range r.config.Settings.Profiles {
		if p == swagger.ProfileBoundary {
			heavy = append(heavy, p)
		} else {
			light = append(light, p)
		}
	}
	return append(light, heavy...)
}

// calcEffectiveIterations computes how many iterations to run for the given
// profile × endpoint combination, honouring the minimum iterations constraint.
func calcEffectiveIterations(
	profile swagger.FuzzingProfile,
	settings swagger.Settings,
	endpoint *swagger.EndpointConfig,
) int {
	minNeeded := generator.MinIterationsNeeded(profile, settings)
	n := settings.IterationsPerProfile
	if minNeeded > n {
		n = minNeeded
	}
	if hasFields(endpoint) {
		return n
	}
	// No fields: most profiles only need 1 iteration; malicious needs the
	// minimum (at least 1) to cover its header-fuzzing iterations.
	if profile == swagger.ProfileMalicious {
		if minNeeded < 1 {
			return 1
		}
		return minNeeded
	}
	return 1
}

// calcMaxPayloadSize returns the per-profile payload size ceiling in bytes.
func calcMaxPayloadSize(profile swagger.FuzzingProfile, settings swagger.Settings) int {
	limit := settings.MaxPayloadSizeBytes
	if limit <= 0 {
		limit = defaultMaxPayloadBytes
	}
	if profile == swagger.ProfileBoundary && limit < boundaryMaxPayloadBytes {
		limit = boundaryMaxPayloadBytes
	}
	return limit
}

func endpointRequests(profile swagger.FuzzingProfile, settings swagger.Settings, ep *swagger.EndpointConfig) int {
	baseIter := calcEffectiveIterations(profile, settings, ep)
	if settings.ActiveParameterFuzzing {
		fields := collectTargetFields(ep)
		if len(fields) > 0 {
			return len(fields) * baseIter
		}
	}
	return baseIter
}

// calculateTotalPlanned pre-computes the total number of requests that will be
// sent during the run and stores it for progress reporting.
func (r *Runner) calculateTotalPlanned(profiles []swagger.FuzzingProfile) {
	settings := r.config.Settings
	endpoints := r.config.Endpoints
	var total int64

	// 1. Baseline: 1 request per endpoint.
	total += int64(len(endpoints))

	// 2. Fuzz profiles.
	for _, ep := range endpoints {
		for _, p := range profiles {
			total += int64(endpointRequests(p, settings, &ep))
		}
	}

	// 3. Rate-limit phase burst requests.
	if settings.RateLimitCheck {
		burst := settings.RateLimitBurstSize
		if burst <= 0 {
			burst = 50
		}
		if burst > 1000 {
			burst = 1000
		}
		total += int64(len(endpoints) * burst)
	}

	r.progress.totalPlanned.Store(total)

	totalEP := len(endpoints) + len(profiles)*len(endpoints)
	if settings.RateLimitCheck {
		totalEP += len(endpoints)
	}
	r.progress.totalEndpoints.Store(int32(totalEP)) // #nosec G115
}

// ─── Run lifecycle helpers ────────────────────────────────────────────────────

// initRun validates that no run is active, initialises all per-run state, and
// returns a new context that is cancelled when Stop() is called.
func (r *Runner) initRun(parentCtx context.Context) (context.Context, error) {
	r.lifecycle.mu.Lock()
	defer r.lifecycle.mu.Unlock()

	if r.lifecycle.isRunning.Load() {
		return nil, fmt.Errorf("already running")
	}

	r.lifecycle.isRunning.Store(true)
	r.lifecycle.isPaused.Store(false)
	r.lifecycle.shouldStop.Store(false)

	// Re-create channels (may have been closed by a previous run).
	r.statsChan = make(chan statsMsg, 4096)
	r.statsDone = make(chan struct{})

	empty := newEmptyStats()
	r.latestStats.Store(&empty)
	r.sizeBaselines = &sync.Map{}
	r.timeBaselines = &sync.Map{}

	oob.GlobalStore.Clear()
	sstistore.GlobalStore.Clear()

	ctx, cancel := context.WithCancel(parentCtx)
	r.lifecycle.cancel = cancel

	// Connect to MCP Server if configured
	if r.mcpClient != nil {
		logger.Info("[Runner] Connecting to MCP Server...")
		if err := r.mcpClient.Connect(ctx); err != nil {
			logger.Error("[Runner] Failed to connect to MCP server: %v", err)
			cancel()
			r.lifecycle.isRunning.Store(false)
			return nil, fmt.Errorf("failed to connect to MCP server: %w", err)
		}

		logger.Info("[Runner] Listing MCP Tools...")
		tools, err := r.mcpClient.ListTools(ctx)
		if err != nil {
			logger.Error("[Runner] Failed to list MCP tools: %v", err)
			_ = r.mcpClient.Close()
			cancel()
			r.lifecycle.isRunning.Store(false)
			return nil, fmt.Errorf("failed to list MCP tools: %w", err)
		}

		hasAnyMcpInConfig := false
		for _, ep := range r.config.Endpoints {
			if ep.Method == "CALL" || ep.Method == "MCP" || strings.HasPrefix(ep.Path, "mcp://tool/") {
				hasAnyMcpInConfig = true
				break
			}
		}

		logger.Info("[Runner] Found %d MCP Tools", len(tools))
		for _, tool := range tools {
			toolPath := "mcp://tool/" + tool.Name

			// Check if this tool is already in r.config.Endpoints (either with mcp://tool/ prefix or raw name)
			foundIndex := -1
			for i, ep := range r.config.Endpoints {
				if ep.Path == toolPath || ep.Path == tool.Name {
					foundIndex = i
					break
				}
			}

			if foundIndex != -1 {
				logger.Info("[Runner] Upgrading MCP tool in-place: %s", tool.Name)
				r.config.Endpoints[foundIndex].Path = toolPath
				r.config.Endpoints[foundIndex].Method = "CALL"
				r.config.Endpoints[foundIndex].Schema = tool.InputSchema
				r.config.Endpoints[foundIndex].ContentType = "application/json"
			} else if !hasAnyMcpInConfig {
				logger.Info("[Runner] Mapping new MCP tool: %s", tool.Name)
				ep := swagger.EndpointConfig{
					Path:        toolPath,
					Method:      "CALL",
					Schema:      tool.InputSchema,
					ContentType: "application/json",
				}
				r.config.Endpoints = append(r.config.Endpoints, ep)
			}
		}
	}

	go r.statsAggregator()

	r.resultsMu.Lock()
	r.allResults = nil
	r.resultsMu.Unlock()

	return ctx, nil
}

// finaliseRun is deferred in Start() to cancel the run context, drain stats,
// update the lifecycle flag, and broadcast the completion event.
func (r *Runner) finaliseRun() {
	r.lifecycle.mu.Lock()
	if r.lifecycle.cancel != nil {
		r.lifecycle.cancel()
	}
	r.lifecycle.mu.Unlock()

	// Signal stats aggregator to flush and exit.
	close(r.statsChan)
	<-r.statsDone

	r.lifecycle.isRunning.Store(false)

	final := r.GetStats()
	final.IsRunning = false
	final.Progress.CurrentEndpoint = ""
	final.Progress.CurrentProfile = ""
	r.latestStats.Store(&final)
	r.Broadcast(Event{Type: EventComplete, Data: final})

	if r.mcpClient != nil {
		_ = r.mcpClient.Close()
	}
	sstistore.GlobalStore.Clear()
	oob.GlobalStore.ClearSession(r.config.RunID)
}

// ─── Private helpers ──────────────────────────────────────────────────────────

func (r *Runner) stopped() bool { return r.lifecycle.shouldStop.Load() }

func (r *Runner) paused() bool { return r.lifecycle.isPaused.Load() }

func (r *Runner) logDebug(format string, v ...interface{}) {
	if logger.IsDebugEnabled() || r.config.Settings.Debug {
		logger.Debug(format, v...)
	}
}

func truncateLog(msg string) string {
	const maxSize = 32768
	if len(msg) > maxSize {
		count := 0
		for i := range msg {
			if count == maxSize {
				return msg[:i] + "... [TRUNCATED]"
			}
			count++
		}
	}
	return msg
}

func (r *Runner) logInfo(format string, v ...interface{}) {
	logger.Info(format, v...)
	r.Broadcast(Event{
		Type: "runner_log",
		Data: map[string]interface{}{
			"level":     "info",
			"message":   truncateLog(fmt.Sprintf(format, v...)),
			"timestamp": time.Now().Format(time.RFC3339),
		},
	})
}

func (r *Runner) logWarn(format string, v ...interface{}) {
	logger.Warn(format, v...)
	r.Broadcast(Event{
		Type: "runner_log",
		Data: map[string]interface{}{
			"level":     "warn",
			"message":   truncateLog(fmt.Sprintf(format, v...)),
			"timestamp": time.Now().Format(time.RFC3339),
		},
	})
}

func (r *Runner) logError(format string, v ...interface{}) {
	logger.Error(format, v...)
	r.Broadcast(Event{
		Type: "runner_log",
		Data: map[string]interface{}{
			"level":     "error",
			"message":   truncateLog(fmt.Sprintf(format, v...)),
			"timestamp": time.Now().Format(time.RFC3339),
		},
	})
}

func (r *Runner) runPreScanLLM(ctx context.Context) {
	if !r.config.Settings.UseLLMPrepass {
		return
	}

	googleKey := os.Getenv("GOOGLE_API_KEY")
	if googleKey == "" {
		googleKey = os.Getenv("OPENAI_API_KEY")
	}

	planner := ai.NewSemanticPlanner(r.config.Settings.AIGatewayURL, r.config.Settings.CFAigToken, googleKey)

	var summaryBuilder strings.Builder
	for _, ep := range r.config.Endpoints {
		summaryBuilder.WriteString(fmt.Sprintf("Endpoint: %s %s\n", ep.Method, ep.Path))
		for pName, pProp := range ep.QueryParams {
			if pProp != nil {
				summaryBuilder.WriteString(fmt.Sprintf("  Param: %s (%s, %s)\n", pName, pProp.Type, pProp.Format))
			}
		}
	}

	customPayloads, err := planner.GeneratePreScanPayloads(ctx, summaryBuilder.String())
	if err != nil {
		r.logWarn("[AI] ⚠️ Pre-Scan LLM Batching failed: %v", err)
		return
	}

	if len(customPayloads) > 0 {
		if r.config.Dictionaries == nil {
			r.config.Dictionaries = make(map[string][]any)
		}
		anyPayloads := make([]any, len(customPayloads))
		for i, p := range customPayloads {
			anyPayloads[i] = p
		}
		r.config.Dictionaries["custom_llm"] = anyPayloads
		r.logInfo("[AI] ✅ Registered %d custom LLM payloads into fuzzing dictionary", len(customPayloads))
	}
}
