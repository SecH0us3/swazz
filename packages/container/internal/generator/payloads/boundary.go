// Package payloads contains boundary and malicious payload constants for fuzzing.
package payloads

import (
	"math"
	"strings"
)

// ─── String boundaries ─────────────────────────────────

var BoundaryStrings = []any{
	"",                             // Empty string
	" ",                            // Single space
	"  \t\n  ",                     // Whitespace variants
	strings.Repeat("A", 256),       // Common VARCHAR limit
	strings.Repeat("A", 1000),      // Medium length
	strings.Repeat("A", 10_000),    // Large string
	strings.Repeat("A", 100_000),   // Very large string
	strings.Repeat("A", 1_048_576), // 1MB string (stress test)
	strings.Repeat("\n", 1000),     // Newlines only
	strings.Repeat("0", 10_000),    // Numeric-looking string
	strings.Repeat(" ", 10_000),    // Spaces only
	strings.Repeat("あ", 5000),     // Multi-byte Unicode (Japanese)
	strings.Repeat("🔥", 2500),    // 4-byte emoji sequence
}

// ─── Integer boundaries ─────────────────────────────────

var BoundaryIntegers = []any{
	0,
	-1,
	1,
	127,           // Max Int8
	-128,          // Min Int8
	255,           // Max UInt8
	32767,         // Max Int16
	-32768,        // Min Int16
	65535,         // Max UInt16
	2147483647,    // Max Int32
	-2147483648,   // Min Int32
	4294967295,    // Max UInt32
	9007199254740991,  // 2^53 - 1 (JS MAX_SAFE_INTEGER)
	-9007199254740991, // -(2^53 - 1)
}

// ─── Number (float) boundaries ──────────────────────────

var BoundaryNumbers = []any{
	0.0,
	-0.0,
	0.1 + 0.2,          // Floating point precision: 0.30000000000000004
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

// ─── Array boundaries ───────────────────────────────────

var BoundaryArraySizes = []any{
	0,
	1,
	100,
	1000,
}
