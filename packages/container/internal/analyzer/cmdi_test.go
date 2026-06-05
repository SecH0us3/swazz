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
		profile       swagger.FuzzingProfile
		expectedCount int
		expectedRule  string
	}{
		{
			name:          "POSIX id command execution output",
			response:      "uid=1000(alex) gid=1000(alex) groups=1000(alex),4(adm),24(cdrom)",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/cmdi-leak",
		},
		{
			name:          "Windows cmd.exe environment signature",
			response:      "Microsoft Windows [Version 10.0.19045]\n(c) Microsoft Corporation. All rights reserved.",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/cmdi-leak",
		},
		{
			name:          "Windows nt authority system user signature",
			response:      "nt authority\\system",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/cmdi-leak",
		},
		{
			name:          "False positive: plain uid= in JSON (no parentheses) should not match",
			response:      `{"uid": 1000, "gid": 42, "groups": ["admin", "users"]}`,
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "No command execution output",
			response:      "User alex logged in successfully.",
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Non-malicious profile should be ignored",
			response:      "uid=1000(alex) gid=1000(alex) groups=1000(alex)",
			profile:       swagger.ProfileBoundary,
			expectedCount: 0,
		},
		{
			name:          "Random profile should be ignored",
			response:      "uid=0(root) gid=0(root) groups=0(root)",
			profile:       swagger.ProfileRandom,
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
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
