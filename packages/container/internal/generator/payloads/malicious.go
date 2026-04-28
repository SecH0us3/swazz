package payloads

import "math"

// ─── Null bytes & Encoding attacks ──────────────────────

var maliciousEncoding = []string{
	"\x00",                              // Null byte
	"\x00\x00\x00\x00",                  // Multiple null bytes
	"\r\n\r\n",                          // CRLF injection
	"\r\n",                              // Carriage return + newline
	"\t\b\f",                            // Control characters
	"\u200B",                            // Zero-width space
	"\u200E\u200F",                      // LTR/RTL marks
	"\uFEFF",                            // BOM character
	"\uFFFD",                            // Replacement character
	"test\x00injected",                  // Null byte in middle
	"normal\r\nX-Injected: header",      // Header injection
	"%00%0a%0d",                         // URL-encoded control chars
	"\u202E\u0041\u0042\u0043",          // Right-to-left override
}

// ─── SQL Injection payloads ─────────────────────────────

var maliciousSQLi = []string{
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
}

// ─── XSS payloads ───────────────────────────────────────

var maliciousXSS = []string{
	"<script>alert(1)</script>",
	"<svg/onload=alert(1)>",
	"<img src=x onerror=alert(1)>",
	"<body onload=alert(1)>",
	`"><script>alert(document.cookie)</script>`,
	"javascript:alert('XSS')",
	`<iframe src="javascript:alert(1)">`,
	"<details open ontoggle=alert(1)>",
	`<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)>`,
	`{{constructor.constructor("return this")().alert(1)}}`,
}

// ─── Path Traversal ─────────────────────────────────────

var maliciousPathTraversal = []string{
	"../../../../etc/passwd",
	`..\\..\\..\\..\\windows\\system32\\config\\sam`,
	"....//....//....//etc/passwd",
	"/etc/shadow",
	"%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
	"..%252f..%252f..%252fetc%252fpasswd",
	"file:///etc/passwd",
}

// ─── Type confusion values ──────────────────────────────

var MaliciousTypeConfusion = []any{
	nil,
	[]any{},
	map[string]any{},
	"NaN",
	[]any{nil},
	map[string]any{"toString": "not a function"},
	[]any{1, []any{2, []any{3, []any{4}}}},
	"",
	0,
	false,
	-1,
}

// ─── Number abuse ───────────────────────────────────────

var MaliciousNumbers = []any{
	"NaN",
	math.Inf(1),
	math.Inf(-1),
	"1e500",
	"0x0",
	"0o0",
	"0b0",
	1.0000000000000002,
	-0.0,
	math.Inf(1), // Infinity (was MaxFloat64 * 2 in TS)
	1e-400,
	"99999999999999999999999999999",
}

// ─── Date abuse ─────────────────────────────────────────

var MaliciousDates = []any{
	"2023-02-29T00:00:00.000Z",
	"2023-13-32T25:61:61.000Z",
	"10000-01-01T00:00:00.000Z",
	"not-a-date",
	"",
	"0",
	"999999999999",
	"2023-00-00",
	"-001-01-01T00:00:00.000Z",
}

// ─── Boolean abuse ──────────────────────────────────────

var MaliciousBooleans = []any{
	"true",
	"false",
	1,
	0,
	nil,
	"yes",
	"no",
	"",
	"TRUE",
	"1",
	"0",
	[]any{},
}

// ─── Aggregate: all string-type malicious payloads ──────

var AllMaliciousStrings []any

func init() {
	all := make([]any, 0, len(maliciousEncoding)+len(maliciousSQLi)+len(maliciousXSS)+len(maliciousPathTraversal))
	for _, s := range maliciousEncoding {
		all = append(all, s)
	}
	for _, s := range maliciousSQLi {
		all = append(all, s)
	}
	for _, s := range maliciousXSS {
		all = append(all, s)
	}
	for _, s := range maliciousPathTraversal {
		all = append(all, s)
	}
	AllMaliciousStrings = all
}
