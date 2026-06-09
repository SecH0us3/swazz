// runner.go: Core execution engine for the swazz fuzzer.
// It orchestrates the fuzzing process across endpoints, profiles, and iterations,
// managing concurrency and the request-response lifecycle.

package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/security"
	"swazz-engine/internal/swagger"
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

	analyzer      *analyzer.AnalyzerRegistry
	sizeBaselines *sync.Map
	timeBaselines *sync.Map
	harvestedIDs  sync.Map // maps path prefix string -> []string
	idSources     sync.Map // maps ID string -> source string
	resultsMu     sync.Mutex
	allResults    []*swagger.FuzzResult
	limiter       *ConcurrencyLimiter

	reauthMu        sync.Mutex
	csrfMu          sync.RWMutex
	activeCSRFToken string

	stateMu      sync.RWMutex
	state        map[string]string
	regexCache   map[string]*regexp.Regexp
	regexCacheMu sync.RWMutex
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
	r.limiter = NewConcurrencyLimiter(config.Settings.Concurrency)
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
	r.timeBaselines = &sync.Map{}

	// Clear the global OOB store to prevent memory leaks from stale UUIDs of previous runs
	oob.GlobalStore.Clear()

	ctx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.lifecycleMu.Unlock()

	// Launch the stats aggregator goroutine.
	go r.statsAggregator()

	r.resultsMu.Lock()
	r.allResults = nil
	r.resultsMu.Unlock()

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

	r.limiter.SetTarget(r.config.Settings.Concurrency)
	var wg sync.WaitGroup

	r.currentProfile.Store("BASELINE")
	r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

	for _, endpoint := range r.config.Endpoints {
		if r.stopped() {
			break
		}
		key := fmt.Sprintf("%s %s", strings.ToUpper(endpoint.Method), endpoint.Path)
		if _, ok := r.sizeBaselines.Load(key); !ok {
			r.limiter.Acquire()
			wg.Add(1)

			go func(ep swagger.EndpointConfig) {
				defer func() {
					r.limiter.Release()
					wg.Done()
				}()

				epKey := ep.Method + " " + ep.Path
				r.currentEndpoint.Store(epKey)
				r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})

				safeGen := generator.New(r.config.Dictionaries, swagger.ProfileRandom, r.config.Settings)
				safeGen.Endpoint = epKey
				var payload any
				var qp map[string]any
				var gh map[string]string
				if ep.Example != nil {
					isBody := !isNoBodyMethod(ep.Method)
					if isBody {
						payload = ep.Example
					} else {
						if m, ok := ep.Example.(map[string]any); ok {
							qp = m
						}
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
				} else if hasFields(&ep) {
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
					swagger.FuzzingProfile("BASELINE"),
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
					r.recordTimeBaseline(ep.Method, ep.Path, result.Duration)
				}

				// Send result to aggregator
				r.statsChan <- statsMsg{
					result:           result,
					currentIteration: 1,
					totalIterations:  1,
				}
				r.Broadcast(Event{Type: EventResult, Data: result})

				r.completedEndpoints.Add(1)
				r.Broadcast(Event{Type: EventProgress, Data: r.GetStats()})
			}(endpoint)
		} else {
			// Baseline already loaded (e.g. from tests or prior setup)
			r.completedEndpoints.Add(1)
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

	r.resultsMu.Lock()
	candidates := make([]*swagger.FuzzResult, len(r.allResults))
	copy(candidates, r.allResults)
	r.resultsMu.Unlock()

	_ = r.bolaPhase(ctx, candidates)

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

	// 1. Baseline requests: 1 per endpoint
	totalPlanned += int64(len(endpoints))

	// 2. Fuzzing profiles requests
	for _, ep := range endpoints {
		hasF := hasFields(&ep)
		for _, p := range profiles {
			minNeeded := generator.MinIterationsNeeded(p, settings)
			baseIter := iterations
			if minNeeded > baseIter {
				baseIter = minNeeded
			}
			if !hasF {
				if p == swagger.ProfileMalicious {
					baseIter = minNeeded
					if baseIter < 1 {
						baseIter = 1
					}
				} else {
					baseIter = 1
				}
			}
			totalPlanned += int64(baseIter)
		}
	}

	// 3. Rate Limit check requests
	if settings.RateLimitCheck {
		burstSize := settings.RateLimitBurstSize
		if burstSize <= 0 {
			burstSize = 50
		}
		if burstSize > 1000 {
			burstSize = 1000
		}
		totalPlanned += int64(len(endpoints) * burstSize)
	}

	r.totalPlanned.Store(totalPlanned)

	// Calculate totalEndpoints:
	// - Baseline: len(endpoints)
	// - Fuzzing: len(profiles) * len(endpoints)
	// - Rate Limit: len(endpoints) if RateLimitCheck is true
	totalEP := len(endpoints) + len(profiles)*len(endpoints)
	if settings.RateLimitCheck {
		totalEP += len(endpoints)
	}
	r.totalEndpoints.Store(int32(totalEP)) // #nosec G115
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
	r.completedEndpoints.Store(int32(len(endpoints) + profileIdx*len(endpoints) + epIdx)) // #nosec G115

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
				if profile == swagger.ProfileRandom && isBodyMethod && rand.Float64() < 0.15 { // #nosec G404
					// In RANDOM profile, there is a 15% chance to send an empty object `{}`
					// as the request body to test API robustness.
					generated = map[string]any{}
				} else if isSecHeaderIter {
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

		r.limiter.Acquire()
		wg.Add(1)

		go func(it int, p any, qp map[string]any, gh map[string]string) {
			defer func() {
				r.limiter.Release()
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
				r.recordTimeBaseline(endpoint.Method, endpoint.Path, result.Duration)
			}

			// Send result to aggregator (buffered, non-blocking under normal load).
			r.statsChan <- statsMsg{
				result:           result,
				currentIteration: it + 1,
				totalIterations:  effectiveIterations,
			}
			// Broadcast individual result immediately (lock-free MPSCQueue).
			r.Broadcast(Event{Type: EventResult, Data: result})

			if result.Status >= 200 && result.Status < 300 {
				r.resultsMu.Lock()
				r.allResults = append(r.allResults, result)
				r.resultsMu.Unlock()
			}
		}(i, payload, queryParams, generatedHeaders)

		if delay > 0 {
			time.Sleep(delay)
		}
	}

	wg.Wait()

	r.completedEndpoints.Store(int32(len(endpoints) + profileIdx*len(endpoints) + epIdx + 1)) // #nosec G115
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

// ConcurrencyLimiter is a dynamic, thread-safe semaphore that allows
// adjusting the worker limit on the fly.
