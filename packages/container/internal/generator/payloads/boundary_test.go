// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package payloads

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestLongString_Build(t *testing.T) {
	l := LongString{Unit: "A", Count: 1000}
	if l.Len() != 1000 {
		t.Fatalf("Len() = %d, want 1000", l.Len())
	}
	if got := l.Build(0); got != strings.Repeat("A", 1000) {
		t.Errorf("Build(0) must not cut, got %d bytes", len(got))
	}
	if got := l.Build(5000); len(got) != 1000 {
		t.Errorf("Build above Len must not pad, got %d bytes", len(got))
	}
	if got := l.Build(10); got != "AAAAAAAAAA" {
		t.Errorf("Build(10) = %q", got)
	}

	// A multi-byte unit is cut on a whole unit, so the result stays valid UTF-8.
	emoji := LongString{Unit: "🔥", Count: 100}
	got := emoji.Build(10)
	if len(got) != 8 || !utf8.ValidString(got) {
		t.Errorf("Build(10) of a 4-byte unit = %q (%d bytes), want two whole runes", got, len(got))
	}
}

// The megabyte boundary strings must stay lazy: built at package init, they cost every process
// (CLI, agent, MCP server) about 190 MB whether a boundary scan runs or not.
func TestBoundaryStrings_NoMegabyteStringsAtInit(t *testing.T) {
	const limit = 256 << 10
	sawLong := false
	for i, v := range BoundaryStrings {
		switch s := v.(type) {
		case string:
			if len(s) > limit {
				t.Errorf("BoundaryStrings[%d] is a %d-byte string built at init; use LongString", i, len(s))
			}
		case LongString:
			sawLong = true
		}
	}
	if !sawLong {
		t.Error("expected the megabyte payloads as LongString entries")
	}
}

// A small cap leaves out the plain 100KB and 256KB strings too, not only the LongStrings.
func TestBoundaryStringsFitting_SmallCap(t *testing.T) {
	const capBytes = 64 << 10
	fitting := BoundaryStringsFitting(capBytes)
	for _, v := range fitting {
		switch s := v.(type) {
		case LongString:
			t.Errorf("a %d-byte LongString kept under a %d-byte cap", s.Len(), capBytes)
		case string:
			if len(s) > 1024 && len(s)+MinEnvelopeBytes > capBytes {
				t.Errorf("a %d-byte string kept under a %d-byte cap", len(s), capBytes)
			}
		}
	}
	if len(fitting) != len(BoundaryStrings)-10 {
		t.Errorf("got %d fitting, want all but the 100KB, 256KB and eight LongStrings (%d)", len(fitting), len(BoundaryStrings)-10)
	}
	// A cap too small for anything still leaves the short strings to send.
	if len(BoundaryStringsFitting(1)) == 0 {
		t.Error("a tiny cap must keep the short boundary strings")
	}
}
