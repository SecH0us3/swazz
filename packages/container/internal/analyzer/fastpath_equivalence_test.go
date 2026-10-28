// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"math/rand/v2"
	"net/url"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// The fast paths in front of the analyzers' regexes and prefilters must find exactly what the
// regex or fold scan they stand in for finds. These tests compare them on bodies assembled from
// fragments that sit near the edge of a match: keys and values in either case, partial
// signatures, word characters around IPs, non-ASCII bytes.
//
// The fragments include the two non-ASCII runes Go's (?i) folds onto ASCII letters, U+017F
// LATIN SMALL LETTER LONG S (s) and U+212A KELVIN SIGN (k): the (?i) fast paths fall back to
// their regex when a body holds one.

var equivalenceFragments = []string{
	`"`, `'`, ` `, "\n", "\t", `:`, `,`, `{`, `}`, `[`, `]`, `*`, `(`, `)`, `=`, `.`, `_`, `-`,
	"0", "1", "7", "16", "31", "99", "256", "x", "Z", "é", "\xff",
	`role`, `ROLE`, `role_id`, `is_admin`, `Admin`, `superadmin`, `tier`, `permissions`, `verified`, `Status`,
	`"role"`, `"Status"`, `"admin" : "admin"`, `"tier":1`, `"verified": true`, `"permissions":["*"]`, `"status":"active"`,
	`10.`, `10.0.0.1`, `172.`, `172.16.4.4`, `172.15.1.1`, `192.168.`, `192.168.1.10`, `a10.1.1.1`, `_192.168.0.1`, `110.1.1.1`,
	`uid=`, `gid=`, `groups=`, `uid=0(root)`, `uid=1000(alex) gid=1000(alex)`, `groups=27(sudo)`, `id=5`,
	`bash: `, `bash: foo: command not found`, `command not found`,
	`root:x:0:0:`, `[boot loader]`, `[boot loader] timeout=30`,
	`ActiveRecord::UnknownAttributeError`, `activerecord::unknownattributeerror`, `UnrecognizedPropertyException`,
	`Cannot set property 'role' on`, `cannot set property 'tier' on`, `MongoError: Unknown modifier: $set.status`,
	"\u017f", "\u212a", "\"\u017ftatus\":\"active\"", "Un\u212anownAttributeError", "ActiveRecord::Un\u212anownAttributeError",
}

func equivalenceBodies(n int) [][]byte {
	rng := rand.New(rand.NewPCG(1, 2))
	bodies := make([][]byte, 0, n)
	for range n {
		var sb strings.Builder
		for range 1 + rng.IntN(24) {
			sb.WriteString(equivalenceFragments[rng.IntN(len(equivalenceFragments))])
		}
		bodies = append(bodies, []byte(sb.String()))
	}
	return bodies
}

func largeEquivalenceBodies(n int) [][]byte {
	rng := rand.New(rand.NewPCG(3, 4))
	bodies := make([][]byte, 0, n)
	for range n {
		var sb strings.Builder
		targetLen := minBigramBodyLen - 256 + rng.IntN(1024)
		for sb.Len() < targetLen {
			sb.WriteString(equivalenceFragments[rng.IntN(len(equivalenceFragments))])
		}
		bodies = append(bodies, []byte(sb.String()))
	}
	return bodies
}

func TestFastPathsMatchTheirRegexes(t *testing.T) {
	internalIPRx := regexp.MustCompile(internalIPPattern)
	var customLFI, customRCE *regexp.Regexp
	var lfiLiterals, rceLiterals []string
	for _, r := range CustomRules {
		switch r.RuleID {
		case "swazz/sensitive-data-leak":
			customLFI, lfiLiterals = regexp.MustCompile(r.Pattern), r.Literals
		case "swazz/rce-leak":
			customRCE, rceLiterals = regexp.MustCompile(r.Pattern), r.Literals
		}
	}
	if customLFI == nil || customRCE == nil {
		t.Fatal("built-in custom rules not found")
	}

	// Each regex must match some bodies, or the comparison says nothing.
	hits := map[string]int{}
	for _, body := range equivalenceBodies(20000) {
		input := &AnalysisInput{ResponseBody: body}
		for name, rx := range map[string]*regexp.Regexp{
			"massAssignment": massAssignmentRx, "ormError": ormErrorRx, "internalIP": internalIPRx,
			"unixID": unixIdRegex, "customLFI": customLFI, "customRCE": customRCE,
		} {
			if rx.Match(body) {
				hits[name]++
			}
		}

		if got, want := findMassAssignment(input), massAssignmentRx.FindIndex(body); !slices.Equal(got, want) {
			t.Fatalf("findMassAssignment(%q) = %v, regex finds %v", body, got, want)
		}
		if got, want := findORMError(input), ormErrorRx.FindIndex(body); !slices.Equal(got, want) {
			t.Fatalf("findORMError(%q) = %v, regex finds %v", body, got, want)
		}
		if got, want := findInternalIP(body), internalIPRx.FindIndex(body); !slices.Equal(got, want) {
			t.Fatalf("findInternalIP(%q) = %v, regex finds %v", body, got, want)
		}
		if got, want := findUnixID(body), unixIdRegex.Find(body); string(got) != string(want) {
			t.Fatalf("findUnixID(%q) = %q, regex finds %q", body, got, want)
		}
		if customLFI.Match(body) && !containsAnyLiteral(body, lfiLiterals) {
			t.Fatalf("LFI rule matches %q but its literals skip it", body)
		}
		if customRCE.Match(body) && !containsAnyLiteral(body, rceLiterals) {
			t.Fatalf("RCE rule matches %q but its literals skip it", body)
		}
	}
	for _, name := range []string{"massAssignment", "ormError", "internalIP", "unixID", "customLFI", "customRCE"} {
		if hits[name] < 100 {
			t.Errorf("%s matched only %d bodies; the corpus no longer exercises it", name, hits[name])
		}
	}
}

func TestContainsLowerMatchesFoldASCII(t *testing.T) {
	needles := []string{"role", "status", "10.", "uid=", "command not found", "é", "ROLE", "Admin", ""}
	bodies := append(equivalenceBodies(5000), nil, []byte{}, []byte("ÉSTATUS"), []byte("\xffROLE\xfe"))
	bodies = append(bodies, largeEquivalenceBodies(2000)...)
	for _, body := range bodies {
		input := &AnalysisInput{ResponseBody: body}
		for _, needle := range needles {
			if got, want := input.containsAnyLower(needle), containsFoldASCII(body, needle); got != want {
				t.Fatalf("containsAnyLower(%q, %q) = %v, containsFoldASCII = %v", body, needle, got, want)
			}
		}
		if got, want := input.containsAnyLower(needles[:4]...), containsAnyFoldASCII(body, needles[:4]...); got != want {
			t.Fatalf("containsAnyLower(%q) = %v, containsAnyFoldASCII = %v", body, got, want)
		}
		input.release()
	}
}

var crlfEquivalenceFragments = []string{
	"\r", "\n", "\r\n", "%0d", "%0a", "%0D", "%0A",
	"%u000d", "%u000a", "%u000D", "%u000A",
	"%E5%98%8D", "%e5%98%8d", "%E5%98%8A", "%e5%98%8a",
	"\u560d", "\u560a", "+", "%20", "%250d", "%250a",
	"Set-Cookie: a=b", "X-Test: 1", "X-Injected: test", "Header-Name: val",
	"foo", "bar", "plain text", "123", "", " ", ":", "%", "\xe5\x98",
}

func refSplitOnCRLF(s string) []string {
	normalized := crlfReplacer.Replace(s)
	parts := strings.Split(normalized, "\n")
	if len(parts) <= 1 {
		return nil
	}
	return parts[1:]
}

func refExtractInjectedHeaders(a *CRLFAnalyzer, payload string) []injectedHeader {
	normalizedPayload := payloadNormalizer.Replace(payload)

	var results []injectedHeader

	// Strategy 1: Split on raw CRLF sequences (\r\n, \r, \n)
	results = append(results, a.parseHeadersFromLines(refSplitOnCRLF(normalizedPayload))...)

	// Strategy 2a: Path-decode the payload and split on CRLF (preserves +)
	decodedPath, err := url.PathUnescape(normalizedPayload)
	if err == nil && decodedPath != normalizedPayload {
		results = append(results, a.parseHeadersFromLines(refSplitOnCRLF(decodedPath))...)

		// Try to decode it twice (for double URL-encoded payloads)
		doubleDecodedPath, err2 := url.PathUnescape(decodedPath)
		if err2 == nil && doubleDecodedPath != decodedPath {
			results = append(results, a.parseHeadersFromLines(refSplitOnCRLF(doubleDecodedPath))...)
		}
	}

	// Strategy 2b: Query-decode the payload and split on CRLF (decodes + to space)
	decodedQuery, err := url.QueryUnescape(normalizedPayload)
	if err == nil && decodedQuery != normalizedPayload {
		results = append(results, a.parseHeadersFromLines(refSplitOnCRLF(decodedQuery))...)

		// Try to decode it twice (for double URL-encoded payloads)
		doubleDecodedQuery, err2 := url.QueryUnescape(decodedQuery)
		if err2 == nil && doubleDecodedQuery != decodedQuery {
			results = append(results, a.parseHeadersFromLines(refSplitOnCRLF(doubleDecodedQuery))...)
		}
	}

	return deduplicateHeaders(results)
}

func TestCRLFFastPathMatchesReference(t *testing.T) {
	analyzer := NewCRLFAnalyzer()
	rng := rand.New(rand.NewPCG(42, 99))

	testCases := []string{
		"", "plain", "\r", "\n", "\r\n", "Set-Cookie: a=b\r\n", "\r\nSet-Cookie: a=b",
		"%0d%0aSet-Cookie: a=b", "%250d%250aSet-Cookie: a=b", "\u560d\u560aSet-Cookie: a=b",
		"%E5%98%8D%E5%98%8ASet-Cookie: a=b", "%u000d%u000aSet-Cookie: a=b",
		"a+b\r\nSet-Cookie: a=b", "a%20b\r\nSet-Cookie: a=b", "X-Header: value\n",
		"\xe5\x98", "\xe5\x98\x8d\xe5\x98\x8a", "clean-token-value-without-crlf",
		"http://example.com/api?q=foo%0d%0aHeader: injection",
	}

	for range 10000 {
		var sb strings.Builder
		count := 1 + rng.IntN(8)
		for range count {
			sb.WriteString(crlfEquivalenceFragments[rng.IntN(len(crlfEquivalenceFragments))])
		}
		testCases = append(testCases, sb.String())
	}

	splitHits := 0
	headerHits := 0

	for i, s := range testCases {
		gotSplit := splitOnCRLF(s)
		wantSplit := refSplitOnCRLF(s)
		if !slices.Equal(gotSplit, wantSplit) {
			t.Fatalf("case %d: splitOnCRLF(%q) = %v; want %v", i, s, gotSplit, wantSplit)
		}
		if len(gotSplit) > 0 {
			splitHits++
		}

		gotHeaders := analyzer.extractInjectedHeaders(s)
		wantHeaders := refExtractInjectedHeaders(analyzer, s)
		if !reflect.DeepEqual(gotHeaders, wantHeaders) {
			t.Fatalf("case %d: extractInjectedHeaders(%q) = %v; want %v", i, s, gotHeaders, wantHeaders)
		}
		if len(gotHeaders) > 0 {
			headerHits++
		}
	}

	if splitHits < 100 {
		t.Errorf("splitHits = %d, expected >= 100", splitHits)
	}
	if headerHits < 100 {
		t.Errorf("headerHits = %d, expected >= 100", headerHits)
	}
}

type customTestStruct struct {
	Key   string
	Value string
}

func TestPayloadContainsMatchesPayloadText(t *testing.T) {
	rng := rand.New(rand.NewPCG(100, 200))

	needles := []string{
		"role", "is_admin", "admin", "superadmin", "permissions", "verified", "tier", "status",
		"eyJhbGciOiJub25l", "__proto__", "constructor.prototype", "prototype.polluted", "polluted",
		"nonexistent_token", "custom_flag",
	}

	words := []string{
		"user", "account", "settings", "role", "admin", "status", "active", "guest",
		"permissions", "tier", "verified", "polluted", "__proto__", "eyJhbGciOiJub25l",
		"xyz", "foo", "bar", "data", "test", "value",
	}

	// 1. Explicit targeted test cases
	explicitCases := []struct {
		payload any
		needle  string
		want    bool
	}{
		{nil, "admin", false},
		{"admin", "admin", true},
		{"bearer eyJhbGciOiJub25l.xxx", "eyJhbGciOiJub25l", true},
		{[]byte("contains_polluted_prop"), "polluted", false},
		{map[string]any{"role": "user"}, "role", true},
		{map[string]any{"user": "admin"}, "admin", true},
		{map[string]string{"is_admin": "true"}, "is_admin", true},
		{[]string{"hello", "superadmin"}, "superadmin", true},
		{[]any{1, 2, "verified"}, "verified", true},
		{map[string]any{"nested": map[string]any{"level2": []any{"status"}}}, "status", true},
		{map[string]any{"nested": map[string]any{"permissions": 42}}, "permissions", true},
		{customTestStruct{Key: "custom_flag", Value: "123"}, "custom_flag", true},
		{map[string]any{"num": 12345, "bool": true}, "admin", false},
		{[]any{100, 200, 300}, "tier", false},
	}

	for i, tc := range explicitCases {
		input := &AnalysisInput{SentPayload: tc.payload}
		got := input.payloadContains(tc.needle)
		if got != tc.want {
			t.Fatalf("explicitCase %d: payloadContains(%q) on %v = %v; want %v", i, tc.needle, tc.payload, got, tc.want)
		}
	}

	// 2. Randomized complex payloads comparing payloadContains vs strings.Contains(payloadText)
	matchCount := 0
	for range 2000 {
		needle := needles[rng.IntN(len(needles))]

		var payload any
		kind := rng.IntN(6)
		switch kind {
		case 0:
			// Flat map
			m := make(map[string]any)
			for range 1 + rng.IntN(5) {
				k := words[rng.IntN(len(words))]
				if rng.IntN(2) == 0 {
					m[k] = words[rng.IntN(len(words))]
				} else {
					m[k] = rng.IntN(100)
				}
			}
			payload = m
		case 1:
			// Nested map with slices
			inner := make([]any, 0)
			for range 1 + rng.IntN(4) {
				if rng.IntN(2) == 0 {
					inner = append(inner, words[rng.IntN(len(words))])
				} else {
					inner = append(inner, rng.IntN(50))
				}
			}
			payload = map[string]any{
				words[rng.IntN(len(words))]: map[string]any{
					words[rng.IntN(len(words))]: inner,
				},
			}
		case 2:
			// map[string]string
			m := make(map[string]string)
			for range 1 + rng.IntN(4) {
				m[words[rng.IntN(len(words))]] = words[rng.IntN(len(words))]
			}
			payload = m
		case 3:
			// []string
			s := make([]string, 0)
			for range 1 + rng.IntN(5) {
				s = append(s, words[rng.IntN(len(words))])
			}
			payload = s
		case 4:
			// Raw string
			payload = words[rng.IntN(len(words))] + "_" + words[rng.IntN(len(words))]
		case 5:
			// Custom struct
			payload = customTestStruct{
				Key:   words[rng.IntN(len(words))],
				Value: words[rng.IntN(len(words))],
			}
		}

		input := &AnalysisInput{SentPayload: payload}
		got := input.payloadContains(needle)
		want := strings.Contains(input.payloadText(), needle)
		if got != want {
			t.Fatalf("payloadContains(%q) = %v; payloadText(%q) = %v (payload: %#v)",
				needle, got, input.payloadText(), want, payload)
		}
		if got {
			matchCount++
		}
	}

	if matchCount < 100 {
		t.Errorf("matchCount = %d, expected >= 100 matches in randomized test", matchCount)
	}
}

func TestAnalysisInputViewsAreComputedOnce(t *testing.T) {
	payload := map[string]any{"name": "x", "tags": []any{"a", "b"}}
	input := &AnalysisInput{ResponseBody: []byte("AbC"), SentPayload: payload}
	if got := string(input.lowerBody()); got != "abc" {
		t.Fatalf("lowerBody = %q", got)
	}
	input.ResponseBody = []byte("CHANGED")
	if got := string(input.lowerBody()); got != "abc" {
		t.Fatalf("lowerBody recomputed: %q", got)
	}
	input.release()
	if got := string(input.lowerBody()); got != "changed" {
		t.Fatalf("lowerBody after release = %q, want it computed again", got)
	}
	input.release()
	strs := input.sentStrings()
	slices.Sort(strs)
	if !slices.Equal(strs, []string{"a", "b", "x"}) {
		t.Fatalf("sentStrings = %v", strs)
	}
	if got := input.payloadText(); got != "map[name:x tags:[a b]]" {
		t.Fatalf("payloadText = %q", got)
	}
	if got := (&AnalysisInput{}).payloadText(); got != "<nil>" {
		t.Fatalf("payloadText of nil payload = %q, want %%v's <nil>", got)
	}

	// Large body to test bigrams caching and release
	largeBody := make([]byte, minBigramBodyLen+100)
	for i := range largeBody {
		largeBody[i] = 'a'
	}
	inputLarge := &AnalysisInput{ResponseBody: largeBody}
	bg1 := inputLarge.bodyBigrams()
	bg2 := inputLarge.bodyBigrams()
	if bg1 != bg2 {
		t.Fatalf("bodyBigrams recomputed without release")
	}
	inputLarge.release()
	if inputLarge.bigrams != nil || inputLarge.bigramsDone || inputLarge.needleChecks != 0 {
		t.Fatalf("bodyBigrams not cleared after release")
	}
}

func TestPayloadNormalizerPrefixesCoverAllKeys(t *testing.T) {
	for i := 0; i < len(payloadNormalizePairs); i += 2 {
		key := payloadNormalizePairs[i]
		if !needsPayloadNormalize("prefix_" + key + "_suffix") {
			t.Fatalf("needsPayloadNormalize did not match payloadNormalizer key %q", key)
		}
	}
}

func TestAnalyzerGuardsCoverAllSignatures(t *testing.T) {
	sqli := &SQLiAnalyzer{}
	stack := &StackTraceAnalyzer{}
	sens := &SensitiveAnalyzer{}
	mass := &MassAssignmentAnalyzer{}

	samples := []struct {
		name     string
		analyzer ResponseAnalyzer
		input    *AnalysisInput
		wantRule string
	}{
		{"MySQL JDBC", sqli, &AnalysisInput{ResponseBody: []byte("com.mysql.jdbc.exceptions.jdbc4.CommunicationsException")}, "swazz/sql-error-leak"},
		{"PostgreSQL", sqli, &AnalysisInput{ResponseBody: []byte("PSQLException: connection refused")}, "swazz/sql-error-leak"},
		{"Oracle", sqli, &AnalysisInput{ResponseBody: []byte("ORA-00933: SQL command not properly ended")}, "swazz/sql-error-leak"},
		{"NPE Java", stack, &AnalysisInput{ResponseBody: []byte(`Cannot invoke "User.getName()" because "u" is null`)}, "swazz/null-pointer-exception"},
		{"NPE PHP", stack, &AnalysisInput{ResponseBody: []byte("Call to a member function getId() on null")}, "swazz/null-pointer-exception"},
		{"NPE NodeJS", stack, &AnalysisInput{ResponseBody: []byte("Cannot read properties of null (reading 'id')")}, "swazz/null-pointer-exception"},
		{"NPE Ruby", stack, &AnalysisInput{ResponseBody: []byte("undefined method `foo' for nil:NilClass")}, "swazz/null-pointer-exception"},
		{"Stack Flask", stack, &AnalysisInput{ResponseBody: []byte("in flask/app.py")}, "swazz/stack-trace-leak"},
		{"Stack Catalina", stack, &AnalysisInput{ResponseBody: []byte("org.apache.catalina.connector.CoyoteAdapter")}, "swazz/stack-trace-leak"},
		{"Sensitive AWS", sens, &AnalysisInput{ResponseBody: []byte("key=AKIAIOSFODNN7EXAMPLE")}, "swazz/sensitive-data-leak"},
		{"Sensitive IP", sens, &AnalysisInput{ResponseBody: []byte("host: 192.168.1.42")}, "swazz/sensitive-data-leak"},
		{"MassAssign ORM", mass, &AnalysisInput{ResponseBody: []byte("ActiveRecord::UnknownAttributeError: unknown attribute 'foo'")}, "swazz/mass-assignment"},
		{"MassAssign Reflected", mass, &AnalysisInput{SentPayload: map[string]any{"is_admin": true}, ResponseBody: []byte(`{"id":1,"is_admin":true}`)}, "swazz/mass-assignment"},
	}

	for _, tc := range samples {
		findings := tc.analyzer.Analyze(tc.input)
		if len(findings) == 0 || findings[0].RuleID != tc.wantRule {
			t.Fatalf("%s: Analyze(%q) = %v, want finding %q", tc.name, tc.input.ResponseBody, findings, tc.wantRule)
		}
		tc.input.release()
	}
}
