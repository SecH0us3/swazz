package analyzer

import (
	"net/http"
	"strings"
	"swazz-engine/internal/swagger"
	"testing"
)

func TestCORSAnalyzer(t *testing.T) {
	analyzer := &CORSAnalyzer{}

	tests := []struct {
		name          string
		headers       http.Header
		profile       swagger.FuzzingProfile
		expectedCount int
		expectedMsg   string
	}{
		{
			name:          "No CORS headers",
			headers:       http.Header{},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name: "Wildcard CORS origin allowed",
			headers: http.Header{
				"Access-Control-Allow-Origin": []string{"*"},
			},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedMsg:   "CORS wildcard",
		},
		{
			name: "Reflected malicious origin (evil.com)",
			headers: http.Header{
				"Access-Control-Allow-Origin": []string{"https://evil.com"},
			},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedMsg:   "CORS origin reflection: server reflected suspicious origin 'https://evil.com'",
		},
		{
			name: "Reflected malicious origin (attacker.com)",
			headers: http.Header{
				"Access-Control-Allow-Origin": []string{"http://attacker.com"},
			},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedMsg:   "CORS origin reflection: server reflected suspicious origin 'http://attacker.com'",
		},
		{
			name: "Reflected null origin",
			headers: http.Header{
				"Access-Control-Allow-Origin": []string{"null"},
			},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedMsg:   "CORS null origin",
		},
		{
			name: "Safe/fixed origin reflection",
			headers: http.Header{
				"Access-Control-Allow-Origin": []string{"https://google.com"},
			},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name: "Wildcard ACAO on non-malicious profile should be ignored",
			headers: http.Header{
				"Access-Control-Allow-Origin": []string{"*"},
			},
			profile:       swagger.ProfileBoundary,
			expectedCount: 0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			input := &AnalysisInput{
				ResponseHeaders: tc.headers,
				Profile:         tc.profile,
			}
			findings := analyzer.Analyze(input)
			if len(findings) != tc.expectedCount {
				t.Fatalf("Expected %d findings, got %d: %v", tc.expectedCount, len(findings), findings)
			}
			if tc.expectedCount > 0 {
				finding := findings[0]
				if finding.RuleID != "swazz/cors-misconfig" {
					t.Errorf("Expected rule ID 'swazz/cors-misconfig', got %q", finding.RuleID)
				}
				if finding.Level != "warning" {
					t.Errorf("Expected level 'warning', got %q", finding.Level)
				}
				if tc.expectedMsg != "" && !strings.Contains(finding.Message, tc.expectedMsg) {
					t.Errorf("Expected message to contain %q, got %q", tc.expectedMsg, finding.Message)
				}
			}
		})
	}
}
