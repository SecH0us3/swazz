/**
 * Malicious payload constants — designed to trigger
 * parser failures, injection vulnerabilities, and type confusion.
 */

// ─── Null bytes & Encoding attacks ──────────────────────

export const MALICIOUS_ENCODING: string[] = [
    '\u0000',                             // Null byte
    '\x00\x00\x00\x00',                   // Multiple null bytes
    '\r\n\r\n',                            // CRLF injection
    '\r\n',                                // Carriage return + newline
    '\t\b\f',                              // Control characters
    '\u200B',                              // Zero-width space
    '\u200E\u200F',                        // LTR/RTL marks
    '\uFEFF',                              // BOM character
    '\uFFFD',                              // Replacement character
    '\uD800',                              // Unpaired surrogate (invalid UTF-16)
    'test\x00injected',                    // Null byte in middle
    'normal\r\nX-Injected: header',        // Header injection
    '%00%0a%0d',                           // URL-encoded control chars
    '\u202E\u0041\u0042\u0043',            // Right-to-left override
];

// ─── SQL Injection payloads ─────────────────────────────

export const MALICIOUS_SQLI: string[] = [
    "' OR 1=1 --",
    "' OR '1'='1",
    "'; DROP TABLE users;--",
    "1; SELECT * FROM information_schema.tables",
    "' UNION SELECT NULL, NULL, NULL --",
    "1' AND SLEEP(5)--",
    "admin'--",
    "' OR 1=1#",
    "1; EXEC xp_cmdshell('whoami')",
    "' WAITFOR DELAY '0:0:5'--",
    "1 OR 1=1",
    "' AND 1=CONVERT(int, (SELECT @@version))--",
];

// ─── XSS payloads ───────────────────────────────────────

export const MALICIOUS_XSS: string[] = [
    '<script>alert(1)</script>',
    '<svg/onload=alert(1)>',
    '<img src=x onerror=alert(1)>',
    '<body onload=alert(1)>',
    '"><script>alert(document.cookie)</script>',
    "javascript:alert('XSS')",
    '<iframe src="javascript:alert(1)">',
    '<details open ontoggle=alert(1)>',
    '<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>',
    '{{constructor.constructor("return this")().alert(1)}}',
];

// ─── Path Traversal ─────────────────────────────────────

export const MALICIOUS_PATH_TRAVERSAL: string[] = [
    '../../../../etc/passwd',
    '..\\..\\..\\..\\windows\\system32\\config\\sam',
    '....//....//....//etc/passwd',
    '/etc/shadow',
    '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '..%252f..%252f..%252fetc%252fpasswd',
    'file:///etc/passwd',
];

// ─── Type confusion values ──────────────────────────────

export const MALICIOUS_TYPE_CONFUSION: any[] = [
    null,
    undefined,
    [],
    {},
    NaN,
    [null],
    { toString: 'not a function' },
    [1, [2, [3, [4]]]],
    '',
    0,
    false,
    -1,
];

// ─── Number abuse ───────────────────────────────────────

export const MALICIOUS_NUMBERS: any[] = [
    NaN,
    Infinity,
    -Infinity,
    '1e500',                              // Parser overflow
    '0x0',                                // Hex
    '0o0',                                // Octal
    '0b0',                                // Binary
    1.0000000000000002,                   // Precision loss
    -0,
    Number.MAX_VALUE * 2,                 // Infinity
    1e-400,                               // Underflow to 0
    '99999999999999999999999999999',      // BigInt-like string
];

// ─── Date abuse ─────────────────────────────────────────

export const MALICIOUS_DATES: string[] = [
    '2023-02-29T00:00:00.000Z',          // Not a leap year
    '2023-13-32T25:61:61.000Z',          // Completely invalid
    '10000-01-01T00:00:00.000Z',         // 5-digit year
    'not-a-date',
    '',
    '0',
    '999999999999',
    '2023-00-00',                          // Zero month/day
    '-001-01-01T00:00:00.000Z',           // Negative year
];

// ─── Boolean abuse ──────────────────────────────────────

export const MALICIOUS_BOOLEANS: any[] = [
    'true',           // String instead of boolean
    'false',
    1,
    0,
    null,
    'yes',
    'no',
    '',
    'TRUE',
    '1',
    '0',
    [],
];

// ─── Aggregate: all string-type malicious payloads ──────

export const ALL_MALICIOUS_STRINGS: string[] = [
    ...MALICIOUS_ENCODING,
    ...MALICIOUS_SQLI,
    ...MALICIOUS_XSS,
    ...MALICIOUS_PATH_TRAVERSAL,
];
