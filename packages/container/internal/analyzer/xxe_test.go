package analyzer

import (
	"swazz-engine/internal/swagger"
	"testing"
)

func TestXXEAnalyzer(t *testing.T) {
	a := &XXEAnalyzer{}

	tests := []struct {
		name          string
		payload       any
		response      string
		profile       swagger.FuzzingProfile
		expectedCount int
		expectedRule  string
	}{
		{
			name:          "XXE leak with etc passwd signature",
			payload:       `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`,
			response:      "root:x:0:0:root:/root:/bin/bash\nbin:x:1:1:bin:/bin:/sbin/nologin",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/xxe-leak",
		},
		{
			name:          "XXE leak with win.ini signature",
			payload:       `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///c:/windows/win.ini">]><foo>&xxe;</foo>`,
			response:      "; for 16-bit app support\n[extensions]\n[fonts]\n[mci extensions]",
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/xxe-leak",
		},
		{
			name:          "Response has file signature but payload was not XML/XXE",
			payload:       "../../../../etc/passwd",
			response:      "root:x:0:0:root:/root:/bin/bash\nbin:x:1:1:bin:/bin:/sbin/nologin",
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "No matching file signature in response",
			payload:       `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`,
			response:      "Invalid XML input received.",
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Non-malicious profile should be ignored",
			payload:       `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`,
			response:      "root:x:0:0:root:/root:/bin/bash\nbin:x:1:1:bin:/bin:/sbin/nologin",
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
