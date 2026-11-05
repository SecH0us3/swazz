// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Package payloads contains boundary and malicious payload constants for fuzzing.
package payloads

import (
	"math"
	"strings"
)

// ─── String boundaries ─────────────────────────────────

var BoundaryStrings = []any{
	"",                           // Empty string
	" ",                          // Single space
	"  \t\n  ",                   // Whitespace variants
	strings.Repeat("A", 256),     // Common VARCHAR limit
	strings.Repeat("A", 1000),    // Medium length
	strings.Repeat("A", 10_000),  // Large string
	strings.Repeat("A", 100_000), // Very large string
	strings.Repeat("\n", 1000),   // Newlines only
	strings.Repeat("0", 10_000),  // Numeric-looking string
	strings.Repeat(" ", 10_000),  // Spaces only
	strings.Repeat("あ", 5000),    // Multi-byte Unicode (Japanese)
	strings.Repeat("🔥", 2500),    // 4-byte emoji sequence
	strings.Repeat("A", 262_144), // 256KB string (stress test)
	LongString{"A", 524_288},     // 512KB string
	LongString{"A", 1_048_576},   // 1MB string
	LongString{"A", 2_097_152},   // 2MB string
	LongString{"A", 5_242_880},   // 5MB string
	LongString{"A", 10_485_760},  // 10MB string
	LongString{"A", 20_971_520},  // 20MB string
	LongString{"A", 52_428_800},  // 50MB string
	LongString{"A", 104_857_600}, // 100MB string
}

// BoundaryStringsFitting returns the boundary strings a payload capped at maxBytes can carry: a
// string whose encoding (its quotes and the smallest JSON envelope around it included) exceeds the
// cap is left out, since a payload holding it could never pass the size check. Cut to the cap
// instead, it would be built only to be discarded, and every one over the cap would become the
// same string.
func BoundaryStringsFitting(maxBytes int) []any {
	out := make([]any, 0, len(BoundaryStrings))
	for _, v := range BoundaryStrings {
		if boundaryStringFits(v, maxBytes) {
			out = append(out, v)
		}
	}
	return out
}

// MinEnvelopeBytes is the least JSON the runner's size check counts around a single string
// field: {"body":{"a":""}}. A string longer than the cap minus this can never be sent.
const MinEnvelopeBytes = len(`{"body":{"a":""}}`)

// boundaryStringFits reports whether v can be sent at all under a maxBytes cap. Strings up to
// 1 KB always stay, cut to the cap by the generator: a cap that small is a misconfiguration, and
// dropping them would leave the profile with nothing to send.
func boundaryStringFits(v any, maxBytes int) bool {
	var n int
	switch s := v.(type) {
	case LongString:
		n = s.Len()
	case string:
		n = len(s)
	default:
		return true
	}
	return n <= 1024 || n+MinEnvelopeBytes <= maxBytes
}

// LongString is a string payload too large to keep in memory from start-up: the megabyte
// payloads above would otherwise cost every process (CLI, agent, MCP server) about 190 MB at
// init, used or not. The generator builds one only when it picks it, and no longer than the
// scan's payload size cap (Build).
type LongString struct {
	Unit  string // repeated to make the string
	Count int    // how many times
}

// Len is the length in bytes of the full string.
func (l LongString) Len() int { return len(l.Unit) * l.Count }

// Build returns the string cut to at most maxBytes bytes, without ever building more than that.
// It cuts on a whole Unit, so a multi-byte Unit stays valid UTF-8; maxBytes <= 0 means no cut.
func (l LongString) Build(maxBytes int) string {
	count := l.Count
	if maxBytes > 0 && len(l.Unit) > 0 && l.Len() > maxBytes {
		count = maxBytes / len(l.Unit)
	}
	return strings.Repeat(l.Unit, count)
}

// ─── Integer boundaries ─────────────────────────────────

var BoundaryIntegers = []any{
	0,
	-1,
	1,
	127,               // Max Int8
	-128,              // Min Int8
	255,               // Max UInt8
	32767,             // Max Int16
	-32768,            // Min Int16
	65535,             // Max UInt16
	2147483647,        // Max Int32
	-2147483648,       // Min Int32
	4294967295,        // Max UInt32
	9007199254740991,  // 2^53 - 1 (JS MAX_SAFE_INTEGER)
	-9007199254740991, // -(2^53 - 1)
}

// ─── Number (float) boundaries ──────────────────────────

var BoundaryNumbers = []any{
	0.0,
	-0.0,
	0.1 + 0.2, // Floating point precision: 0.30000000000000004
	math.SmallestNonzeroFloat64,
	math.MaxFloat64,
	1e308,
	-1e308,
	5e-324,
	1.0000000000000002,
	999999999999999.9,
}

// ─── Date-time boundaries ───────────────────────────────

var BoundaryDates = []any{
	"1970-01-01T00:00:00.000Z",
	"1969-12-31T23:59:59.999Z",
	"0000-01-01T00:00:00.000Z",
	"9999-12-31T23:59:59.999Z",
	"2038-01-19T03:14:07.000Z",
	"2000-02-29T00:00:00.000Z",
	"1900-02-28T00:00:00.000Z",
	"2024-12-31T23:59:59.999Z",
	"2024-01-01T00:00:00.000Z",
}

// ─── UUID boundaries ────────────────────────────────────

var BoundaryUUIDs = []any{
	"00000000-0000-0000-0000-000000000000", // Nil UUID
	"ffffffff-ffff-ffff-ffff-ffffffffffff", // Max UUID
	"not-a-uuid",                           // Invalid format
	"",                                     // Empty
}

// ─── Array boundaries ───────────────────────────────────

var BoundaryArraySizes = []any{
	0,
	1,
	2,
	5,
	10,
	50,
	100,
	500,
	1000,
	5000,
	10000,
}

// ─── Boolean boundaries ─────────────────────────────────

var BoundaryBooleans = []any{
	true,
	false,
	nil,
	0,
	1,
	-1,
	"",
	"true",
	"false",
	"yes",
	"no",
	"1",
	"0",
}
