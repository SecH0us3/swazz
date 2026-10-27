// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"math/rand/v2"
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
// Excluded: the two non-ASCII runes Go's (?i) folds onto ASCII letters, U+212A KELVIN SIGN (k)
// and U+017F LATIN SMALL LETTER LONG S (s). Like the ASCII prefilters that already guard the
// (?i) regexes, the fast paths fold ASCII only, so a body spelling a signature with them is not
// matched.

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
	for _, body := range bodies {
		for _, needle := range needles {
			input := &AnalysisInput{ResponseBody: body}
			if got, want := input.containsLower(needle), containsFoldASCII(body, needle); got != want {
				t.Fatalf("containsLower(%q, %q) = %v, containsFoldASCII = %v", body, needle, got, want)
			}
		}
		input := &AnalysisInput{ResponseBody: body}
		if got, want := input.containsAnyLower(needles[:4]...), containsAnyFoldASCII(body, needles[:4]...); got != want {
			t.Fatalf("containsAnyLower(%q) = %v, containsAnyFoldASCII = %v", body, got, want)
		}
	}
}

func TestAnalysisInputViewsAreComputedOnce(t *testing.T) {
	payload := map[string]any{"name": "x", "tags": []any{"a", "b"}}
	input := &AnalysisInput{ResponseBody: []byte("AbC"), SentPayload: payload}
	if got := input.lowerBody(); got != "abc" {
		t.Fatalf("lowerBody = %q", got)
	}
	input.ResponseBody = []byte("changed")
	if got := input.lowerBody(); got != "abc" {
		t.Fatalf("lowerBody recomputed: %q", got)
	}
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
}
