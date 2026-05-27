package analyzer

import (
	"strings"
	"testing"
)

func TestSensitiveAnalyzer(t *testing.T) {
	a := &SensitiveAnalyzer{}

	tests := []struct {
		name          string
		response      string
		expectedCount int
		contains      string
	}{
		{
			name:          "AWS Access Key signature match",
			response:      "My AWS key is AKIAIOSFODNN7EXAMPLE which you shouldn't see",
			expectedCount: 1,
			contains:      "AKIA...MPLE", // prefix/suffix redacting check
		},
		{
			name:          "Private Key Block match",
			response:      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----",
			expectedCount: 1,
			contains:      "----...----",
		},
		{
			name:          "JWT Token match",
			response:      "Header: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
			expectedCount: 1,
			contains:      "eyJh...sw5c",
		},
		{
			name:          "Generic API Key match",
			response:      "apikey = 'api_key_12345678901234567890'",
			expectedCount: 1,
			contains:      "apik...890'",
		},
		{
			name:          "Internal IP match",
			response:      "Database running on 192.168.1.50 in private subnet",
			expectedCount: 1,
			contains:      "192....1.50",
		},
		{
			name:          "No match on regular response",
			response:      `{"status":"ok","ip":"8.8.8.8"}`, // public DNS IP is not internal
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				ResponseBody: []byte(tt.response),
			}
			findings := a.Analyze(input)
			if len(findings) != tt.expectedCount {
				t.Errorf("expected %d findings, got %d", tt.expectedCount, len(findings))
			}
			if len(findings) > 0 {
				if findings[0].RuleID != "swazz/sensitive-data-leak" {
					t.Errorf("expected ruleID swazz/sensitive-data-leak, got %s", findings[0].RuleID)
				}
				if !strings.Contains(findings[0].Evidence, tt.contains) {
					t.Errorf("expected evidence to contain '%s', got '%s'", tt.contains, findings[0].Evidence)
				}
			}
		})
	}
}
