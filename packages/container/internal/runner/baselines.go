// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"container/heap"
	"strings"
	"sync"

	"swazz-engine/internal/swagger"
)

// sortedSamples keeps a running median of its samples in two heaps: the lower half as a max-heap
// and the upper half as a min-heap, sized equal or the lower one larger by one. An insert costs
// O(log n) and a read O(1), under the lock the endpoint's workers share.
type sortedSamples struct {
	mu    sync.Mutex
	lower int64Heap // max-heap, stored negated
	upper int64Heap // min-heap
}

func (s *sortedSamples) add(v int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lower.Len() == 0 || v <= -s.lower[0] {
		heap.Push(&s.lower, -v)
	} else {
		heap.Push(&s.upper, v)
	}
	switch {
	case s.lower.Len() > s.upper.Len()+1:
		heap.Push(&s.upper, -heap.Pop(&s.lower).(int64))
	case s.upper.Len() > s.lower.Len():
		heap.Push(&s.lower, -heap.Pop(&s.upper).(int64))
	}
}

// median returns the middle sample, or the mean of the two middle ones; 0 with no samples.
func (s *sortedSamples) median() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.lower.Len() == 0:
		return 0
	case s.lower.Len() > s.upper.Len():
		return -s.lower[0]
	default:
		return (-s.lower[0] + s.upper[0]) / 2
	}
}

// int64Heap is a min-heap of int64 for container/heap.
type int64Heap []int64

func (h int64Heap) Len() int           { return len(h) }
func (h int64Heap) Less(i, j int) bool { return h[i] < h[j] }
func (h int64Heap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *int64Heap) Push(x any)        { *h = append(*h, x.(int64)) }
func (h *int64Heap) Pop() any {
	old := *h
	v := old[len(old)-1]
	*h = old[:len(old)-1]
	return v
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
