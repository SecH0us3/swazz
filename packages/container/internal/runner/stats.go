// stats.go: Aggregates and tracks metrics for the fuzzing session.
// It maintains real-time counters for status codes, endpoint performance,
// and overall progress, providing snapshots for the UI.

package runner

import (
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
	"time"
)

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
