// stats.go: Aggregates and tracks metrics for the fuzzing session.
// Uses a dedicated aggregator goroutine that owns stats data exclusively,
// eliminating mutex contention from the worker hot path. Workers send
// results via a buffered channel; the aggregator publishes immutable
// snapshots through atomic.Pointer at a fixed 150ms interval.

package runner

import (
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
	"time"
)

// statsMsg is sent from worker goroutines to the stats aggregator.
type statsMsg struct {
	result           *swagger.FuzzResult
	currentIteration int
	totalIterations  int
}

// GetStats returns an immutable snapshot of current stats (lock-free).
func (r *Runner) GetStats() swagger.RunStats {
	p := r.latestStats.Load()
	if p == nil {
		return newEmptyStats()
	}
	return *p
}

// statsAggregator runs as a single background goroutine that owns all
// mutable stats data. It consumes results from statsChan, accumulates
// them without any locks, and publishes snapshots at a fixed interval.
func (r *Runner) statsAggregator() {
	defer close(r.statsDone)

	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()

	stats := newEmptyStats()
	stats.IsRunning = true
	var latestIteration, latestTotalIterations int
	dirty := false

	for {
		select {
		case msg, ok := <-r.statsChan:
			if !ok {
				// Channel closed — publish final snapshot and exit
				r.publishSnapshot(&stats, latestIteration, latestTotalIterations)
				return
			}
			accumulateResult(&stats, msg.result)
			if msg.currentIteration > latestIteration {
				latestIteration = msg.currentIteration
			}
			if msg.totalIterations > latestTotalIterations {
				latestTotalIterations = msg.totalIterations
			}
			dirty = true

		case <-ticker.C:
			if dirty {
				r.publishSnapshot(&stats, latestIteration, latestTotalIterations)
				dirty = false
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
	snap.TotalPlanned = r.totalPlanned.Load()
	if ep, ok := r.currentEndpoint.Load().(string); ok {
		snap.Progress.CurrentEndpoint = ep
	}
	if pr, ok := r.currentProfile.Load().(string); ok {
		snap.Progress.CurrentProfile = pr
	}
	snap.Progress.CompletedEndpoints = int(r.completedEndpoints.Load())
	snap.Progress.TotalEndpoints = int(r.totalEndpoints.Load())
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
