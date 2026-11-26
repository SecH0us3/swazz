// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"swazz-engine/internal/sstistore"
	"swazz-engine/internal/swagger"
	"testing"
)

func TestSSTIAnalyzer(t *testing.T) {
	store := sstistore.NewStore()
	a := &SSTIAnalyzer{Store: store}

	// Register some dynamic payloads in the run's store for test purposes
	store.Register("{{23*37}}", sstistore.SSTIContext{RawExpr: "23*37", Expected: "851"})
	store.Register("{{23+37}}", sstistore.SSTIContext{RawExpr: "23+37", Expected: "60"})
	store.Register("{{23+'37'}}", sstistore.SSTIContext{RawExpr: "23+'37'", Expected: "2337"})
	store.Register("<%= 53+37 %>", sstistore.SSTIContext{RawExpr: "53+37", Expected: "90"})
	store.Register("<%= 4173*6829 %>", sstistore.SSTIContext{RawExpr: "4173*6829", Expected: "28497417"})

	tests := []struct {
		name          string
		payload       any
		response      string
		profile       swagger.FuzzingProfile
		expectedCount int
		expectedRule  string
	}{
		{
			name:          "Dynamic SSTI multiplication 23*37 to 851",
			payload:       "{{23*37}}",
			response:      "Hello 851!",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/ssti-leak",
		},
		{
			name:          "Dynamic SSTI addition 23+37 to 60",
			payload:       "{{23+37}}",
			response:      "Hello 60!",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/ssti-leak",
		},
		{
			name:          "Dynamic SSTI concatenation 23+'37' to 2337",
			payload:       "{{23+'37'}}",
			response:      "Hello 2337!",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/ssti-leak",
		},
		{
			name:          "SSTI evaluation of 7*7 to 49",
			payload:       "{{7*7}}",
			response:      "Hello 49!",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/ssti-leak",
		},
		{
			name:          "SSTI evaluation of 7+'7' to 77",
			payload:       "{{7+'7'}}",
			response:      "Hello 77!",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/ssti-leak",
		},
		{
			name:          "Simple reflection of expression without evaluation",
			payload:       "{{7*7}}",
			response:      "Hello {{7*7}} or 7*7!",
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "No match in response",
			payload:       "{{7*7}}",
			response:      "Hello guest!",
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "False positive: 49 embedded inside larger number (e.g. timestamp) should not match",
			payload:       "{{7*7}}",
			response:      `{"id": 1492, "created_at": 1492000049123}`,
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "False positive: 77 embedded in port or ID should not match",
			payload:       "{{7+'7'}}",
			response:      `{"port": 8077, "user_id": 7777}`,
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Non-malicious profile should be ignored",
			payload:       "{{7*7}}",
			response:      "Hello 49!",
			profile:       swagger.ProfileBoundary,
			expectedCount: 0,
		},
		{
			name:          "False positive regression: 90 inside UUID segment 90be should not match",
			payload:       "<%= 53+37 %>",
			response:      `{"availableMethods":null,"defaultText":"","exceptionType":"ContractValidation","info":null,"key":null,"message":"No Product with Id=04500e5a-a278-47d0-bba6-d0e69fac4b24","ticketId":"ca2daac4-b122-4a4d-90be-8ac6149dfe20"}`,
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "False positive: static 7*7 -> 49 inside hex traceId should not match",
			payload:       "{{7*7}}",
			response:      `{"traceId":"4f8a49c2e1"}`,
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "True positive: FreeMarker comma thousand-separated result matches",
			payload:       "<%= 4173*6829 %>",
			response:      `<p>Total: 28,497,417</p>`,
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/ssti-leak",
		},
		{
			name:          "True positive: NBSP thousand-separated result matches",
			payload:       "<%= 4173*6829 %>",
			response:      "Total: 28\u00a0497\u00a0417",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/ssti-leak",
		},
		{
			name:          "True positive: space, narrow NBSP, and dot thousand-separated results match",
			payload:       "<%= 4173*6829 %>",
			response:      "space: 28 497 417 | narrow: 28\u202f497\u202f417 | dot: 28.497.417",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/ssti-leak",
		},
		{
			name:          "False positive: dot-grouped number with leading group should not match",
			payload:       "<%= 4173*6829 %>",
			response:      `{"version":"1.28.497.417"}`,
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "False positive: thousand-separated result with adjacent leading digit should not match",
			payload:       "<%= 4173*6829 %>",
			response:      `{"id": "128,497,417"}`,
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Reflection of raw expression alongside formatted result should not match",
			payload:       "<%= 4173*6829 %>",
			response:      `28,497,417 (4173*6829)`,
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				SentPayload:  tt.payload,
				ResponseBody: []byte(tt.response),
				Profile:      tt.profile,
			}
			findings := a.Analyze(input)
			if len(findings) != tt.expectedCount {
				t.Errorf("expected %d findings, got %d", tt.expectedCount, len(findings))
			}
			if len(findings) > 0 && findings[0].RuleID != tt.expectedRule {
				t.Errorf("unexpected RuleID: %s", findings[0].RuleID)
			}
		})
	}
}

func TestHasStandaloneNumber(t *testing.T) {
	tests := []struct {
		body     string
		val      string
		expected bool
	}{
		{"Hello 49!", "49", true},
		{"result=49,done", "49", true},
		{`{"id": 1492}`, "49", false},
		{"1492000049123", "49", false},
		{"port: 8077", "77", false},
		{"77 bottles", "77", true},
		{"value=77.", "77", true},
		{"ca2daac4-b122-4a4d-90be-8ac6149dfe20", "90", false},
		{`"traceId":"4f8a49c2e1"`, "49", false},
		{`"etag":"\"a851f\""`, "851", false},
		{"name28497417", "28497417", true},
		{"49apple", "49", true},
		{"name90be", "90", true},
		{"90be", "90", false},
		{"ab90", "90", false},
		{"anything", "", false},
		{"<td>7034790</td>", "7034790", true},
		{`{"description":"48217394"}`, "48217394", true},
		{"ticketId=ca2daac4-b122-4a4d-90be-8ac6149dfe20, count=90", "90", true},
	}

	for _, tt := range tests {
		got := hasStandaloneNumber([]byte(tt.body), []byte(tt.val))
		if got != tt.expected {
			t.Errorf("hasStandaloneNumber(%q, %q) = %v, want %v", tt.body, tt.val, got, tt.expected)
		}
	}
}

func TestSSTIAnalyzer_OnlyMatchesItsOwnRunsExpressions(t *testing.T) {
	own := sstistore.NewStore()
	own.Register("{{23*37}}", sstistore.SSTIContext{RawExpr: "23*37", Expected: "851"})
	input := &AnalysisInput{
		SentPayload:  "{{23*37}}",
		ResponseBody: []byte("Hello 851!"),
		Profile:      swagger.ProfileMalicious,
	}

	if got := NewRegistry(own).Analyze(input); !hasRule(got, "swazz/ssti-leak") {
		t.Fatalf("own run's expression not matched: %+v", got)
	}
	// Another run's registry, or one with no store, does not know this run's expressions.
	if got := NewRegistry(sstistore.NewStore()).Analyze(input); hasRule(got, "swazz/ssti-leak") {
		t.Fatalf("another run's expression matched: %+v", got)
	}
	if got := NewRegistry(nil).Analyze(input); hasRule(got, "swazz/ssti-leak") {
		t.Fatalf("expression matched without a store: %+v", got)
	}
}

func hasRule(findings []swagger.AnalysisFinding, rule string) bool {
	for _, f := range findings {
		if f.RuleID == rule {
			return true
		}
	}
	return false
}

func TestFormatThousands(t *testing.T) {
	tests := []struct {
		digits   string
		sep      string
		expected string
	}{
		{"999", ",", ""},
		{"-1234", ",", ""},
		{"12a4", ",", ""},
		{"1234", ",", "1,234"},
		{"123456", ",", "123,456"},
		{"7034790", " ", "7 034 790"},
		{"28497417", ".", "28.497.417"},
	}

	for _, tt := range tests {
		got := formatThousands([]byte(tt.digits), tt.sep)
		if tt.expected == "" {
			if got != nil {
				t.Errorf("formatThousands(%q, %q) = %q, want nil", tt.digits, tt.sep, string(got))
			}
		} else if string(got) != tt.expected {
			t.Errorf("formatThousands(%q, %q) = %q, want %q", tt.digits, tt.sep, string(got), tt.expected)
		}
	}
}

func BenchmarkSSTIAnalyzer_NoMatch(b *testing.B) {
	store := sstistore.NewStore()
	store.Register("<%= 4173*6829 %>", sstistore.SSTIContext{RawExpr: "4173*6829", Expected: "28497417"})
	a := &SSTIAnalyzer{Store: store}
	input := &AnalysisInput{
		SentPayload:  "<%= 4173*6829 %>",
		ResponseBody: []byte(`{"availableMethods":null,"defaultText":"","exceptionType":"ContractValidation","info":null,"key":null,"message":"No Product with Id=04500e5a-a278-47d0-bba6-d0e69fac4b24","ticketId":"ca2daac4-b122-4a4d-90be-8ac6149dfe20"}`),
		Profile:      swagger.ProfileMalicious,
	}

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		_ = a.Analyze(input)
	}
}
