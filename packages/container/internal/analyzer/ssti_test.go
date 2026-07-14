package analyzer

import (
	"swazz-engine/internal/sstistore"
	"swazz-engine/internal/swagger"
	"testing"
)

func TestSSTIAnalyzer(t *testing.T) {
	a := &SSTIAnalyzer{}

	// Register some dynamic payloads in the store for test purposes
	sstistore.GlobalStore.Register("{{23*37}}", sstistore.SSTIContext{RawExpr: "23*37", Expected: "851"})
	sstistore.GlobalStore.Register("{{23+37}}", sstistore.SSTIContext{RawExpr: "23+37", Expected: "60"})
	sstistore.GlobalStore.Register("{{23+'37'}}", sstistore.SSTIContext{RawExpr: "23+'37'", Expected: "2337"})
	defer sstistore.GlobalStore.Clear()

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
	}

	for _, tt := range tests {
		got := hasStandaloneNumber([]byte(tt.body), []byte(tt.val))
		if got != tt.expected {
			t.Errorf("hasStandaloneNumber(%q, %q) = %v, want %v", tt.body, tt.val, got, tt.expected)
		}
	}
}
