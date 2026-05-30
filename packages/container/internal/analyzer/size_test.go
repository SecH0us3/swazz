package analyzer

import (
	"strings"
	"testing"

	"swazz-engine/internal/swagger"
)

func TestSizeAnalyzer(t *testing.T) {
	a := &SizeAnalyzer{}

	tests := []struct {
		name           string
		profile        swagger.FuzzingProfile
		baselineSize   int64
		responseSize   int64
		sizeMultiplier float64
		expectedCount  int
		evidenceSub    string
	}{
		{
			name:          "Not MALICIOUS profile - no anomaly",
			profile:       swagger.ProfileRandom,
			baselineSize:  100,
			responseSize:  1000,
			expectedCount: 0,
		},
		{
			name:          "Baseline size <= 0 - no anomaly",
			profile:       swagger.ProfileMalicious,
			baselineSize:  0,
			responseSize:  1000,
			expectedCount: 0,
		},
		{
			name:           "Size below threshold (default multiplier 5.0) - no anomaly",
			profile:        swagger.ProfileMalicious,
			baselineSize:   100,
			responseSize:   490,
			sizeMultiplier: 0.0, // defaults to 5.0
			expectedCount:  0,
		},
		{
			name:           "Size above threshold (default multiplier 5.0) - anomaly",
			profile:        swagger.ProfileMalicious,
			baselineSize:   100,
			responseSize:   510,
			sizeMultiplier: 0.0, // defaults to 5.0
			expectedCount:  1,
			evidenceSub:    "Baseline: 100 bytes, Observed: 510 bytes (5.1x larger)",
		},
		{
			name:           "Size below threshold (custom multiplier 3.0) - no anomaly",
			profile:        swagger.ProfileMalicious,
			baselineSize:   100,
			responseSize:   250,
			sizeMultiplier: 3.0,
			expectedCount:  0,
		},
		{
			name:           "Size above threshold (custom multiplier 3.0) - anomaly",
			profile:        swagger.ProfileMalicious,
			baselineSize:   100,
			responseSize:   310,
			sizeMultiplier: 3.0,
			expectedCount:  1,
			evidenceSub:    "Baseline: 100 bytes, Observed: 310 bytes (3.1x larger)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				Profile:        tt.profile,
				BaselineSize:   tt.baselineSize,
				ResponseSize:   tt.responseSize,
				SizeMultiplier: tt.sizeMultiplier,
			}
			findings := a.Analyze(input)
			if len(findings) != tt.expectedCount {
				t.Fatalf("expected %d findings, got %d", tt.expectedCount, len(findings))
			}
			if tt.expectedCount > 0 {
				finding := findings[0]
				if finding.RuleID != "swazz/response-size-anomaly" {
					t.Errorf("expected rule ID 'swazz/response-size-anomaly', got '%s'", finding.RuleID)
				}
				if finding.Level != "warning" {
					t.Errorf("expected level 'warning', got '%s'", finding.Level)
				}
				if !strings.Contains(finding.Evidence, tt.evidenceSub) {
					t.Errorf("expected evidence to contain '%s', got '%s'", tt.evidenceSub, finding.Evidence)
				}
			}
		})
	}
}
