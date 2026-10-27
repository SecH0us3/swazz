// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"math/rand/v2"
	"testing"
)

// rescanWatermark is the watermark as the aggregator computed it before iterationWatermark:
// rescanning 1..total on every result.
type rescanWatermark struct {
	endpoint, profile string
	completed         map[int]bool
}

func (w *rescanWatermark) complete(endpoint, profile string, iteration, total int) int {
	if w.completed == nil {
		w.completed = make(map[int]bool)
	}
	if endpoint != w.endpoint || profile != w.profile {
		w.endpoint, w.profile = endpoint, profile
		clear(w.completed)
	}
	w.completed[iteration] = true
	watermark := 0
	for i := 1; i <= total; i++ {
		if !w.completed[i] {
			break
		}
		watermark = i
	}
	return watermark
}

// The incremental watermark equals the rescanned one after every result: iterations completing
// in any order, a resumed endpoint starting past 1, endpoint and profile switches, and a total
// that changes within one endpoint.
func TestIterationWatermarkMatchesRescan(t *testing.T) {
	rng := rand.New(rand.NewPCG(5, 6))
	var fast iterationWatermark
	var slow rescanWatermark
	endpoints := []string{"GET /a", "POST /b"}
	profiles := []string{"RANDOM", "MALICIOUS"}
	for round := range 300 {
		ep, pr := endpoints[rng.IntN(2)], profiles[rng.IntN(2)]
		total := 1 + rng.IntN(40)
		skip := 0
		if round%5 == 0 {
			skip = rng.IntN(total) // resumed: the first iterations are never sent
		}
		order := rng.Perm(total - skip)
		for _, k := range order {
			it := skip + k + 1
			if rng.IntN(10) == 0 {
				it = rng.IntN(total+5) + 1 // a duplicate, or an iteration past the total
			}
			gotTotal := total
			if rng.IntN(20) == 0 {
				gotTotal = rng.IntN(total + 1)
			}
			got := fast.complete(ep, pr, it, gotTotal)
			want := slow.complete(ep, pr, it, gotTotal)
			if got != want {
				t.Fatalf("round %d: complete(%s %s, iter %d, total %d) = %d, rescan gives %d", round, ep, pr, it, gotTotal, got, want)
			}
		}
	}
}

func BenchmarkIterationWatermark(b *testing.B) {
	// Iterations complete nearly in order, as with a few concurrent workers: shuffled within
	// windows of 5.
	const n, window = 5000, 5
	rng := rand.New(rand.NewPCG(7, 8))
	order := make([]int, 0, n)
	for base := 0; base < n; base += window {
		for _, k := range rng.Perm(window) {
			order = append(order, base+k)
		}
	}
	b.Run("incremental", func(b *testing.B) {
		for range b.N {
			var w iterationWatermark
			for _, k := range order {
				w.complete("GET /a", "RANDOM", k+1, n)
			}
		}
	})
	b.Run("rescan", func(b *testing.B) {
		for range b.N {
			var w rescanWatermark
			for _, k := range order {
				w.complete("GET /a", "RANDOM", k+1, n)
			}
		}
	})
}
