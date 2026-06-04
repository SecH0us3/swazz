package analyzer

import (
	"swazz-engine/internal/swagger"
	"testing"
)

func TestPathTraversalAnalyzer(t *testing.T) {
	a := &PathTraversalAnalyzer{}

	tests := []struct {
		name          string
		response      string
		expectedCount int
		expectedRule  string
	}{
		{
			name:          "Path traversal Unix etc passwd leak",
			response:      "root:x:0:0:root:/root:/bin/bash\nbin:x:1:1:bin:/bin:/sbin/nologin",
			expectedCount: 1,
			expectedRule:  "swazz/path-traversal-leak",
		},
		{
			name:          "Path traversal Windows win.ini leak",
			response:      "; for 16-bit app support\n[extensions]\n[fonts]\n[mci extensions]",
			expectedCount: 1,
			expectedRule:  "swazz/path-traversal-leak",
		},
		{
			name:          "No path traversal signature in response",
			response:      "Hello world, everything is fine.",
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				ResponseBody: []byte(tt.response),
				Profile:      swagger.ProfileMalicious,
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
