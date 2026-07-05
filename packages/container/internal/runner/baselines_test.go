package runner

import (
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
