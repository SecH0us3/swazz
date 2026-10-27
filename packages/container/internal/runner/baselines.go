// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"slices"
	"strings"
	"sync"

	"swazz-engine/internal/swagger"
)

// sortedSamples keeps its samples in ascending order, so the median is read without sorting:
// each insert costs one binary search and a shift, instead of every read after an insert
// copying and sorting all of them under the lock the endpoint's workers share.
type sortedSamples struct {
	mu      sync.Mutex
	samples []int64
}

func (s *sortedSamples) add(v int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	i, _ := slices.BinarySearch(s.samples, v)
	s.samples = slices.Insert(s.samples, i, v)
}

// median returns the middle sample, or the mean of the two middle ones; 0 with no samples.
func (s *sortedSamples) median() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := len(s.samples)
	switch {
	case n == 0:
		return 0
	case n%2 == 1:
		return s.samples[n/2]
	default:
		return (s.samples[n/2-1] + s.samples[n/2]) / 2
	}
}

type EndpointSizeBaseline struct{ sortedSamples }

func (b *EndpointSizeBaseline) addSize(size int64) { b.add(size) }
func (b *EndpointSizeBaseline) getMedian() int64   { return b.median() }

type EndpointTimeBaseline struct{ sortedSamples }

func (b *EndpointTimeBaseline) addTime(t int64)  { b.add(t) }
func (b *EndpointTimeBaseline) getMedian() int64 { return b.median() }

// baselineKey is the key both baselines are stored under: the method uppercased, then the path.
func baselineKey(method, path string) string {
	return strings.ToUpper(method) + " " + path
}

func (r *Runner) recordSizeBaseline(method, path string, size int64) {
	val, _ := r.sizeBaselines.LoadOrStore(baselineKey(method, path), &EndpointSizeBaseline{})
	val.(*EndpointSizeBaseline).addSize(size)
}

func (r *Runner) getSizeBaselineMedian(method, path string) int64 {
	if r.sizeBaselines == nil {
		return 0
	}
	val, ok := r.sizeBaselines.Load(baselineKey(method, path))
	if !ok {
		return 0
	}
	return val.(*EndpointSizeBaseline).getMedian()
}

func (r *Runner) recordTimeBaseline(method, path string, t int64) {
	val, _ := r.timeBaselines.LoadOrStore(baselineKey(method, path), &EndpointTimeBaseline{})
	val.(*EndpointTimeBaseline).addTime(t)
}

func (r *Runner) getTimeBaselineMedian(method, path string) int64 {
	if r.timeBaselines == nil {
		return 0
	}
	val, ok := r.timeBaselines.Load(baselineKey(method, path))
	if !ok {
		return 0
	}
	return val.(*EndpointTimeBaseline).getMedian()
}

// anomalyBaselines returns what the size and timing analyzers compare one response of an endpoint
// against: the endpoint's median size (for MALICIOUS payloads only), the size multiplier, and its
// median duration. The RANDOM profile records both medians under the endpoint's method and path.
func (r *Runner) anomalyBaselines(method, path string, profile swagger.FuzzingProfile, settings swagger.Settings) (baselineSize int64, multiplier float64, baselineTime int64) {
	if profile == swagger.ProfileMalicious {
		baselineSize = r.getSizeBaselineMedian(method, path)
	}
	multiplier = settings.ResponseSizeAnomalyMultiplier
	if multiplier <= 0 {
		multiplier = 5.0
	}
	return baselineSize, multiplier, r.getTimeBaselineMedian(method, path)
}
