// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// stats.go: Aggregates and tracks metrics for the fuzzing session.
// Uses a dedicated aggregator goroutine that owns stats data exclusively,
// eliminating mutex contention from the worker hot path. Workers send
// results via a buffered channel; the aggregator publishes immutable
// snapshots through atomic.Pointer at a fixed 150ms interval.

package runner

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"swazz-engine/internal/swagger"
)

// statsMsg is sent from worker goroutines to the stats aggregator.
type statsMsg struct {
	result           *swagger.FuzzResult
	currentIteration int
	totalIterations  int
	endpoint         string
	profile          string
}

// GetStats returns an immutable snapshot of current stats (lock-free).
func (r *Runner) GetStats() swagger.RunStats {
	var stats swagger.RunStats
	if p := r.latestStats.Load(); p != nil {
		stats = *p
	} else {
		stats = newEmptyStats()
	}
	stats.WAFCheck = r.wafCheckResult.Load()
	return stats
}

type CheckpointData struct {
	Profile   string `json:"profile"`
	Endpoint  string `json:"endpoint"`
	Iteration int    `json:"iteration"`
}

// statsPipe connects one run's workers to its statsAggregator. The run ends it with close, never
// by closing ch: a worker that outlived the run (finalise gives up waiting for it) may still send,
// and a send on a closed channel would panic it.
type statsPipe struct {
	ch chan statsMsg
	// mu is held for reading by every send in progress; close takes it for writing, so once
	// sealed is closed no send is in progress or can start, and the aggregator's final drain of
	// ch takes in every message a send reported as delivered.
	mu      sync.RWMutex
	stopped bool
	stop    chan struct{} // closed first: a send blocked on a full ch gives up
	sealed  chan struct{} // closed once stopped is set; the aggregator drains ch and returns
	done    chan struct{} // closed by the aggregator when it has returned
	once    sync.Once
}

func newStatsPipe() *statsPipe {
	return &statsPipe{
		ch:     make(chan statsMsg, 4096),
		stop:   make(chan struct{}),
		sealed: make(chan struct{}),
		done:   make(chan struct{}),
	}
}

// stoppedStatsPipe is the pipe of a runner with no run: sends are dropped, and close returns.
func stoppedStatsPipe() *statsPipe {
	p := &statsPipe{stopped: true, stop: make(chan struct{}), sealed: make(chan struct{}), done: make(chan struct{})}
	close(p.stop)
	close(p.sealed)
	close(p.done)
	p.once.Do(func() {})
	return p
}

// send hands msg to the aggregator and reports whether it did. It gives up (false) once the run
// has ended, or when cancel is closed while ch is full; a nil cancel never fires.
func (p *statsPipe) send(msg statsMsg, cancel <-chan struct{}) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.stopped {
		return false
	}
	select {
	case p.ch <- msg:
		return true
	case <-p.stop:
		return false
	case <-cancel:
		return false
	}
}

// close ends the pipe once its aggregator has taken in every delivered message, and waits for
// that. Calling it again only waits.
func (p *statsPipe) close() {
	p.once.Do(func() {
		close(p.stop)
		p.mu.Lock()
		p.stopped = true
		p.mu.Unlock()
		close(p.sealed)
	})
	<-p.done
}

// sendStats hands msg to the run's statsAggregator. Once the run has ended it drops msg instead
// of blocking on an aggregator that is gone, and returns false.
func (r *Runner) sendStats(msg statsMsg) bool {
	if msg.result != nil && msg.result.NotSent {
		return false // never sent: dropped whole, like a late result
	}
	return r.stats.Load().send(msg, nil)
}

// sendStatsUntil is sendStats that also gives up when ctx ends while the pipe is full.
func (r *Runner) sendStatsUntil(ctx context.Context, msg statsMsg) bool {
	return r.stats.Load().send(msg, ctx.Done())
}


// stopStats ends the run's statsAggregator once it has taken in what was sent, and waits for it.
func (r *Runner) stopStats() {
	r.stats.Load().close()
}

// statsAggregator runs as a single background goroutine that owns all
// mutable stats data. It consumes results from the run's statsPipe, accumulates
// them without any locks, and publishes snapshots at a fixed interval.
func (r *Runner) statsAggregator(p *statsPipe) {
	defer close(p.done)

	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()

	stats := newEmptyStats()
	stats.IsRunning = true
	var latestIteration, latestTotalIterations int
	dirty := false
	var lastCheckpointRequests int64
	var initializedTotalRequests bool

	// Track completed iterations per endpoint to safely compute the contiguous watermark
	completedIters := make(map[int]bool)
	var activeEp, activePr string

	handle := func(msg statsMsg) {
		if !initializedTotalRequests {
			stats.TotalRequests = r.progress.totalRequests.Load()
			lastCheckpointRequests = stats.TotalRequests
			initializedTotalRequests = true
		}
		accumulateResult(&stats, msg.result)

		// If we switched to a new endpoint/profile, reset the completed iterations tracking
		if msg.endpoint != activeEp || msg.profile != activePr {
			activeEp = msg.endpoint
			activePr = msg.profile
			clear(completedIters)
		}
		completedIters[msg.currentIteration] = true

		// Compute the contiguous watermark (highest iteration N where 1..N are all complete)
		watermark := 0
		for i := 1; i <= msg.totalIterations; i++ {
			if completedIters[i] {
				watermark = i
			} else {
				break
			}
		}

		latestIteration = watermark
		if msg.totalIterations > latestTotalIterations {
			latestTotalIterations = msg.totalIterations
		}
		dirty = true
	}

	for {
		select {
		case msg := <-p.ch:
			handle(msg)

		case <-p.sealed:
			// No send is in progress or can start, and every delivered message is buffered in
			// ch: take them in, publish the final snapshot and exit.
			for {
				select {
				case msg := <-p.ch:
					handle(msg)
				default:
					r.publishSnapshot(&stats, latestIteration, latestTotalIterations)
					return
				}
			}

		case <-ticker.C:
			if dirty {
				r.publishSnapshot(&stats, latestIteration, latestTotalIterations)
				dirty = false

				currentPr := ""
				if pr, ok := r.progress.currentProfile.Load().(string); ok {
					currentPr = pr
				}

				if currentPr != "BASELINE" && currentPr != "" && stats.TotalRequests-lastCheckpointRequests >= 100 {
					currentEp := ""
					if ep, ok := r.progress.currentEndpoint.Load().(string); ok {
						currentEp = ep
					}
					r.Broadcast(Event{
						Type: EventCheckpoint,
						Data: CheckpointData{
							Profile:   currentPr,
							Endpoint:  currentEp,
							Iteration: latestIteration,
						},
					})
					lastCheckpointRequests = stats.TotalRequests
				}
			}
		}
	}
}

// publishSnapshot builds an immutable stats snapshot, stores it atomically,
// and broadcasts an EventProgress to all SSE subscribers.
func (r *Runner) publishSnapshot(stats *swagger.RunStats, iteration, totalIterations int) {
	snap := *stats // shallow copy
	snap.StatusCounts = copyMapIntInt64(stats.StatusCounts)
	snap.StatusByProfile = copyMapStatusByProfile(stats.StatusByProfile)
	snap.ProfileCounts = copyMapProfileInt64(stats.ProfileCounts)
	snap.EndpointCounts = copyMapEndpoint(stats.EndpointCounts)

	// Merge atomic progress values set by the main loop
	snap.TotalPlanned = r.progress.totalPlanned.Load()
	snap.Concurrency = r.GetConcurrency()
	if ep, ok := r.progress.currentEndpoint.Load().(string); ok {
		snap.Progress.CurrentEndpoint = ep
	}
	if pr, ok := r.progress.currentProfile.Load().(string); ok {
		snap.Progress.CurrentProfile = pr
	}
	snap.Progress.CompletedEndpoints = int(r.progress.completedEndpoints.Load())
	snap.Progress.TotalEndpoints = int(r.progress.totalEndpoints.Load())
	snap.Progress.CurrentIteration = iteration
	snap.Progress.TotalIterations = totalIterations

	// Calculate RPS
	elapsed := float64(time.Now().UnixMilli()-snap.StartTime) / 1000.0
	if elapsed > 0 {
		snap.RequestsPerSec = float64(int(float64(snap.TotalRequests)/elapsed*10)) / 10
	}

	r.latestStats.Store(&snap)
	r.Broadcast(Event{Type: EventProgress, Data: snap})
}

// accumulateResult integrates a single fuzz result into the running stats.
// Called exclusively by the statsAggregator goroutine — no locks needed.
func accumulateResult(stats *swagger.RunStats, result *swagger.FuzzResult) {
	stats.TotalRequests++
	stats.IsRunning = true
	stats.TotalDurationMs += result.Duration

	status := result.Status
	stats.StatusCounts[status]++

	if stats.StatusByProfile[result.Profile] == nil {
		stats.StatusByProfile[result.Profile] = make(map[int]int64)
	}
	stats.StatusByProfile[result.Profile][status]++

	stats.ProfileCounts[result.Profile]++

	epKey := fmt.Sprintf("%s %s", strings.ToUpper(result.Method), result.Endpoint)
	if stats.EndpointCounts[epKey] == nil {
		stats.EndpointCounts[epKey] = make(map[int]int64)
	}
	stats.EndpointCounts[epKey][status]++

	stats.TotalSentBytes += int64(result.PayloadSize)
	stats.TotalResponseBytes += result.ResponseSize
	if result.ResponseSize > stats.MaxResponseSize {
		stats.MaxResponseSize = result.ResponseSize
	}
}

func newEmptyStats() swagger.RunStats {
	return swagger.RunStats{
		StatusCounts:    make(map[int]int64),
		StatusByProfile: make(map[swagger.FuzzingProfile]map[int]int64),
		ProfileCounts:   make(map[swagger.FuzzingProfile]int64),
		EndpointCounts:  make(map[string]map[int]int64),
		StartTime:       time.Now().UnixMilli(),
	}
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
