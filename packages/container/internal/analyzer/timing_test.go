package analyzer

import (
	"testing"
)

func TestTimingAnalyzer_Analyze(t *testing.T) {
	tests := []struct {
		name       string
		input      AnalysisInput
		wantCount  int
		wantRuleID string
	}{
		{
			name: "No baseline",
			input: AnalysisInput{
				SentPayload:    "WAITFOR DELAY '0:0:5'",
				BaselineTimeMs: 0,
				Duration:       5000,
			},
			wantCount: 0,
		},
		{
			name: "Below threshold",
			input: AnalysisInput{
				SentPayload:     "WAITFOR DELAY '0:0:5'",
				BaselineTimeMs:  100,
				Duration:        3000,
				TimeThresholdMs: 4000,
			},
			wantCount: 0,
		},
		{
			name: "SQLi - WAITFOR",
			input: AnalysisInput{
				SentPayload:     "1; WAITFOR DELAY '0:0:5'",
				BaselineTimeMs:  100,
				Duration:        5100,
				TimeThresholdMs: 4000,
			},
			wantCount:  1,
			wantRuleID: "swazz/time-based-sqli",
		},
		{
			name: "SQLi - pg_sleep",
			input: AnalysisInput{
				SentPayload:     "1 OR pg_sleep(5)",
				BaselineTimeMs:  50,
				Duration:        5060,
				TimeThresholdMs: 4000,
			},
			wantCount:  1,
			wantRuleID: "swazz/time-based-sqli",
		},
		{
			name: "CMDi - ;sleep",
			input: AnalysisInput{
				SentPayload:     "id;sleep 5",
				BaselineTimeMs:  50,
				Duration:        5060,
				TimeThresholdMs: 4000,
			},
			wantCount:  1,
			wantRuleID: "swazz/time-based-cmdi",
		},
		{
			name: "CMDi - | sleep",
			input: AnalysisInput{
				SentPayload:     "ping -c 1 8.8.8.8 | sleep 5",
				BaselineTimeMs:  100,
				Duration:        5100,
				TimeThresholdMs: 4000,
			},
			wantCount:  1,
			wantRuleID: "swazz/time-based-cmdi",
		},
		{
			name: "Generic delay but not matching our payloads",
			input: AnalysisInput{
				SentPayload:     "normal payload",
				BaselineTimeMs:  100,
				Duration:        5000,
				TimeThresholdMs: 4000,
			},
			wantCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			analyzer := &TimingAnalyzer{}
			got := analyzer.Analyze(&tt.input)

			if len(got) != tt.wantCount {
				t.Fatalf("Analyze() returned %d findings, want %d", len(got), tt.wantCount)
			}

			if tt.wantCount > 0 && got[0].RuleID != tt.wantRuleID {
				t.Errorf("Analyze() returned RuleID %q, want %q", got[0].RuleID, tt.wantRuleID)
			}
		})
	}
}
