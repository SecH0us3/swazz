package analyzer

import (
	"swazz-engine/internal/swagger"
	"testing"
)

func TestSSTIAnalyzer(t *testing.T) {
	a := &SSTIAnalyzer{}

	tests := []struct {
		name          string
		payload       any
		response      string
		profile       swagger.FuzzingProfile
		expectedCount int
		expectedRule  string
	}{
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
