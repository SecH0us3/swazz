// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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
	"context"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/differential"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/license"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/runner/bola"
	"swazz-engine/internal/security"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/wafcheck"
)

var uuidRegex = regexp.MustCompile(`[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}`)

var scanDurationUnit = time.Minute

const (
	maxRetriesOn429  = 3
	defaultBackoffMs = 2000
)

func (r *Runner) Config() *swagger.Config {
	return r.config
}

// Results returns a copy of all accumulated FuzzResults.
func (r *Runner) Results() []*swagger.FuzzResult {
	r.resultsMu.Lock()
	defer r.resultsMu.Unlock()
	res := make([]*swagger.FuzzResult, len(r.allResults))
	copy(res, r.allResults)
	return res
}

// GetWAFCheckResult returns the result of the pre-scan WAF check, if any.
func (r *Runner) GetWAFCheckResult() *wafcheck.Result {
	return r.wafCheckResult.Load()
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
	statsChan      chan statsMsg
	latestStats    atomic.Pointer[swagger.RunStats]
	wafCheckResult atomic.Pointer[wafcheck.Result]
	statsDone      chan struct{}

	subsMu        sync.RWMutex
	subs          map[chan Event]struct{}
	eventQueue    *MPSCQueue
	doneCh        chan struct{}
	broadcastDone chan struct{}

	// Config variable substitution — written once per config reload.
	configMu    sync.RWMutex
	varReplacer *strings.Replacer

	// WebSocket clients map (key: string address/endpoint, value: *ws.Client)
	wsClients sync.Map

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
	gate          license.Gate

	analyzer *analyzer.AnalyzerRegistry
	detector *bola.Detector

	mcpClient      mcp.Client
	mcpMutex       sync.Mutex
	mcpRateLimiter *mcp.RateLimiter

	grpcClients sync.Map // map[string]*swazzGrpc.Client
}

// New creates a new Runner with sensible defaults.
// An optional license gate caps concurrency and gates paid features.
func New(config *swagger.Config, client *http.Client, gates ...license.Gate) *Runner {
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

	var gate license.Gate = license.NewCommunityGate()
	if len(gates) > 0 && gates[0] != nil {
		gate = gates[0]
	}
	r := &Runner{
		config:         config,
		client:         client,
		gate:           gate,
		subs:           make(map[chan Event]struct{}),
		eventQueue:     NewMPSCQueue(),
		doneCh:         make(chan struct{}),
		broadcastDone:  make(chan struct{}),
		statsChan:      make(chan statsMsg, 4096),
		statsDone:      make(chan struct{}),
		analyzer:       analyzer.NewRegistry(),
		sizeBaselines:  &sync.Map{},
		timeBaselines:  &sync.Map{},
		state:          make(map[string]string),
		regexCache:     make(map[string]*regexp.Regexp),
		mcpRateLimiter: mcp.NewRateLimiter(100, 50),
	}
	if config.MCPServer != nil {
		client, err := mcp.NewClientFromConfig(
			config.MCPServer, config.GlobalHeaders, config.Cookies,
			config.Security.AllowPrivateIPs, nil)
		if err != nil {
			logger.Error("[Runner] %v", err)
		} else {
			r.mcpClient = client
		}
	}
	r.limiter = NewConcurrencyLimiter(config.Settings.Concurrency, gate.ConcurrencyCeiling())
	r.pause.cond = sync.NewCond(&r.pause.mu)
	r.updateReplacer()
	r.detector = bola.NewDetector(r)

	empty := newEmptyStats()
	r.latestStats.Store(&empty)
	go r.broadcastLoop()
	return r
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
	r.runPreScanWAFCheck(runCtx)

	profiles := r.getOrderedProfiles()
	r.calculateTotalPlanned(profiles)
	r.logStartupSummary(profiles)

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

	detector := bola.NewDetector(r)
	_ = detector.BolaPhase(runCtx, candidates)

	diffPhase := differential.NewPhase(r)
	_ = diffPhase.Run(runCtx, candidates)

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

// RunnerContext implementation for bola.Detector
func (r *Runner) RLockConfig()   { r.configMu.RLock() }
func (r *Runner) RUnlockConfig() { r.configMu.RUnlock() }
func (r *Runner) LockConfig()    { r.configMu.Lock() }
func (r *Runner) UnlockConfig() {
	r.configMu.Unlock()
	r.updateReplacer()
	r.detector = bola.NewDetector(r)
}

func (r *Runner) LockResults()   { r.resultsMu.Lock() }
func (r *Runner) UnlockResults() { r.resultsMu.Unlock() }

func (r *Runner) LogDebug(format string, args ...any) { r.logDebug(format, args...) }
func (r *Runner) LogInfo(format string, args ...any)  { r.logInfo(format, args...) }
func (r *Runner) LogWarn(format string, args ...any)  { r.logWarn(format, args...) }
func (r *Runner) LogError(format string, args ...any) { r.logError(format, args...) }

func (r *Runner) BroadcastProgress() { r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()}) }
func (r *Runner) BroadcastResult(res *swagger.FuzzResult) {
	r.Broadcast(Event{Type: EventResult, Data: res})
}

func (r *Runner) UpdateProgressProfile(profile string) { r.progress.currentProfile.Store(profile) }
func (r *Runner) UpdateProgressEndpoint(epKey string)  { r.progress.currentEndpoint.Store(epKey) }
func (r *Runner) AddTotalEndpoints(n int32)            { r.progress.totalEndpoints.Add(n) }
func (r *Runner) AddCompletedEndpoints(n int32)        { r.progress.completedEndpoints.Add(n) }
func (r *Runner) AddTotalPlanned(n int64)              { r.progress.totalPlanned.Add(n) }

func (r *Runner) SendStat(res *swagger.FuzzResult, currentIteration, totalIterations int) {
	r.statsChan <- statsMsg{
		result:           res,
		currentIteration: currentIteration,
		totalIterations:  totalIterations,
	}
}

func (r *Runner) ExecuteRequest(ctx context.Context, baseURL, resolvedPath, epPath, method string,
	globalHeaders map[string]string, globalCookies map[string]string,
	body any, profile swagger.FuzzingProfile, queryParams map[string]any,
	headers map[string]string, contentType string) *swagger.FuzzResult {
	return r.executeRequest(ctx, baseURL, resolvedPath, epPath, method, globalHeaders, globalCookies, body, profile, queryParams, headers, contentType)
}

func (r *Runner) SetLimiterTarget(concurrency int)         { r.limiter.SetTarget(concurrency) }
func (r *Runner) LimiterAcquire(ctx context.Context) error { return r.limiter.Acquire(ctx) }
func (r *Runner) LimiterRelease()                          { r.limiter.Release() }
