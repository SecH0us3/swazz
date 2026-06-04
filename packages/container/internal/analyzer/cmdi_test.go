package analyzer

import (
	"swazz-engine/internal/swagger"
	"testing"
)

func TestCmdiAnalyzer(t *testing.T) {
	a := &CmdiAnalyzer{}

	tests := []struct {
		name          string
		response      string
		expectedCount int
		expectedRule  string
	}{
		{
			name:          "POSIX id command execution output",
			response:      "uid=1000(alex) gid=1000(alex) groups=1000(alex),4(adm),24(cdrom)",
			expectedCount: 1,
			expectedRule:  "swazz/cmdi-leak",
		},
		{
			name:          "Windows cmd.exe environment signature",
			response:      "Microsoft Windows [Version 10.0.19045]\n(c) Microsoft Corporation. All rights reserved.",
			expectedCount: 1,
			expectedRule:  "swazz/cmdi-leak",
		},
		{
			name:          "Windows nt authority system user signature",
			response:      "nt authority\\system",
			expectedCount: 1,
			expectedRule:  "swazz/cmdi-leak",
		},
		{
			name:          "No command execution output",
			response:      "User alex logged in successfully.",
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
