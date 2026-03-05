/**
 * Boundary payload constants — extreme/edge-case values
 * designed to test limits of parsers, databases, and validators.
 */

// ─── String boundaries ─────────────────────────────────

export const BOUNDARY_STRINGS: any[] = [
    '',                           // Empty string
    ' ',                          // Single space
    '  \t\n  ',                   // Whitespace variants
    'A'.repeat(256),              // Common VARCHAR limit
    'A'.repeat(1000),             // Medium length
    'A'.repeat(10_000),           // Large string
    'A'.repeat(100_000),          // Very large string
    'A'.repeat(1_048_576),        // 1MB string (stress test)
    '\n'.repeat(1000),            // Newlines only
    '0'.repeat(10_000),           // Numeric-looking string
    ' '.repeat(10_000),           // Spaces only
    'あ'.repeat(5000),            // Multi-byte Unicode (Japanese)
    '🔥'.repeat(2500),           // 4-byte emoji sequence
];

// ─── Integer boundaries ─────────────────────────────────

export const BOUNDARY_INTEGERS: any[] = [
    0,
    -1,
    1,
    -0,
    127,                          // Max Int8
    -128,                         // Min Int8
    255,                          // Max UInt8
    32767,                        // Max Int16
    -32768,                       // Min Int16
    65535,                        // Max UInt16
    2147483647,                   // Max Int32
    -2147483648,                  // Min Int32
    4294967295,                   // Max UInt32
    Number.MAX_SAFE_INTEGER,      // 2^53 - 1
    Number.MIN_SAFE_INTEGER,      // -(2^53 - 1)
];

// ─── Number (float) boundaries ──────────────────────────

export const BOUNDARY_NUMBERS: any[] = [
    0.0,
    -0.0,
    0.1 + 0.2,                   // Floating point precision: 0.30000000000000004
    Number.EPSILON,
    Number.MIN_VALUE,             // Smallest positive
    Number.MAX_VALUE,             // Largest representable
    1e308,                        // Near MAX_VALUE
    -1e308,
    5e-324,                       // Smallest subnormal
    1.0000000000000002,           // Precision edge
    999999999999999.9,            // 15-digit float
];

// ─── Date-time boundaries ───────────────────────────────

export const BOUNDARY_DATES: string[] = [
    '1970-01-01T00:00:00.000Z',  // Unix epoch
    '1969-12-31T23:59:59.999Z',  // Before epoch
    '0000-01-01T00:00:00.000Z',  // Year 0
    '9999-12-31T23:59:59.999Z',  // Y10K edge
    '2038-01-19T03:14:07.000Z',  // Unix 32-bit overflow
    '2000-02-29T00:00:00.000Z',  // Leap year (valid)
    '1900-02-28T00:00:00.000Z',  // Not a leap year
    '2024-12-31T23:59:59.999Z',  // Year end
    '2024-01-01T00:00:00.000Z',  // Year start
];

// ─── Boolean boundaries ─────────────────────────────────
// (booleans have no special boundaries, but we ensure both)

export const BOUNDARY_BOOLEANS: boolean[] = [
    true,
    false,
];

// ─── Array boundaries ───────────────────────────────────

export const BOUNDARY_ARRAY_SIZES: number[] = [
    0,      // Empty array
    1,      // Single element
    100,    // Medium
    1000,   // Large — stress test
];
