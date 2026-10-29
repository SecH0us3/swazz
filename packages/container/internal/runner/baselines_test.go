// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"math/rand/v2"
	"slices"
	"testing"
)

func TestBaselinesSize(t *testing.T) {
	b := &EndpointSizeBaseline{}

	// Median of empty slice
	if m := b.getMedian(); m != 0 {
		t.Errorf("Expected 0 for empty baseline, got %d", m)
	}

	// Odd number of elements
	b.addSize(10)
	b.addSize(30)
	b.addSize(20)
	if m := b.getMedian(); m != 20 {
		t.Errorf("Expected median 20, got %d", m)
	}

	// Cached result
	if m := b.getMedian(); m != 20 {
		t.Errorf("Expected cached median 20, got %d", m)
	}

	// Even number of elements
	b.addSize(40)
	if m := b.getMedian(); m != 25 {
		t.Errorf("Expected median 25, got %d", m)
	}
}

func TestBaselinesTime(t *testing.T) {
	b := &EndpointTimeBaseline{}

	// Median of empty slice
	if m := b.getMedian(); m != 0 {
		t.Errorf("Expected 0 for empty baseline, got %d", m)
	}

	// Odd number of elements
	b.addTime(10)
	b.addTime(30)
	b.addTime(20)
	if m := b.getMedian(); m != 20 {
		t.Errorf("Expected median 20, got %d", m)
	}

	// Cached result
	if m := b.getMedian(); m != 20 {
		t.Errorf("Expected cached median 20, got %d", m)
	}

	// Even number of elements
	b.addTime(40)
	if m := b.getMedian(); m != 25 {
		t.Errorf("Expected median 25, got %d", m)
	}
}

// The median read from the sorted samples is the one sorting a copy on every read gave.
func TestSortedSamplesMedianMatchesSortingACopy(t *testing.T) {
	rng := rand.New(rand.NewPCG(3, 4))
	for trial := range 200 {
		var s sortedSamples
		var all []int64
		for range rng.IntN(60) {
			v := rng.Int64N(1000) - 100
			if trial%3 == 0 {
				v %= 5 // many duplicates
			}
			s.add(v)
			all = append(all, v)

			sorted := slices.Clone(all)
			slices.Sort(sorted)
			want := sorted[len(sorted)/2]
			if len(sorted)%2 == 0 {
				want = (sorted[len(sorted)/2-1] + sorted[len(sorted)/2]) / 2
			}
			if got := s.median(); got != want {
				t.Fatalf("median of %v = %d, want %d", all, got, want)
			}
		}
	}
	var empty sortedSamples
	if got := empty.median(); got != 0 {
		t.Fatalf("median with no samples = %d, want 0", got)
	}
}
