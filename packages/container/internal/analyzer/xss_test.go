package analyzer

import (
	"net/http"
	"swazz-engine/internal/swagger"
	"testing"
)

func TestXSSAnalyzer(t *testing.T) {
	a := &XSSAnalyzer{}

	tests := []struct {
		name          string
		payload       any
		response      string
		headers       http.Header
		profile       swagger.FuzzingProfile
		expectedCount int
	}{
		{
			name:          "Reflected XSS in HTML",
			payload:       "<script>alert(1)</script>",
			response:      "<html><body><script>alert(1)</script></body></html>",
			headers:       http.Header{"Content-Type": []string{"text/html"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
		},
		{
			name:          "Reflected XSS in Map/Object Payload",
			payload:       map[string]any{"nested": map[string]any{"param": "<script>alert(1)</script>"}},
			response:      "<html><body><script>alert(1)</script></body></html>",
			headers:       http.Header{"Content-Type": []string{"text/html"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
		},
		{
			name:          "Case-insensitive Reflection Check",
			payload:       "<script>alert(1)</script>",
			response:      "<html><body><SCRIPT>ALERT(1)</SCRIPT></body></html>",
			headers:       http.Header{"Content-Type": []string{"text/html"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
		},
		{
			name:          "JSON served with text/html content type (Danger)",
			payload:       "<script>alert(1)</script>",
			response:      `{"error": "<script>alert(1)</script>"}`,
			headers:       http.Header{"Content-Type": []string{"text/html"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
		},
		{
			name:          "Safe Reflection in JSON Content Type",
			payload:       "<script>alert(1)</script>",
			response:      `{"message": "<script>alert(1)</script>"}`,
			headers:       http.Header{"Content-Type": []string{"application/json"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Safe Reflection in Implicit JSON String",
			payload:       "<script>alert(1)</script>",
			response:      `{"message": "<script>alert(1)</script>"}`,
			headers:       http.Header{}, // missing header, but body is valid JSON
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Reflected XSS in text/plain",
			payload:       "<script>alert(1)</script>",
			response:      "Body reflected: <script>alert(1)</script>",
			headers:       http.Header{"Content-Type": []string{"text/plain"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
		},
		{
			name:          "Not reflected XSS payload",
			payload:       "legitimate_string",
			response:      "legitimate_string",
			headers:       http.Header{"Content-Type": []string{"text/html"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0, // not in the list of malicious XSS payloads
		},
		{
			name:          "Non-malicious profile should be ignored",
			payload:       "<script>alert(1)</script>",
			response:      "<html><body><script>alert(1)</script></body></html>",
			headers:       http.Header{"Content-Type": []string{"text/html"}},
			profile:       swagger.ProfileBoundary, // not MALICIOUS
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				SentPayload:     tt.payload,
				ResponseBody:    []byte(tt.response),
				ResponseHeaders: tt.headers,
				Profile:         tt.profile,
			}
			findings := a.Analyze(input)
			if len(findings) != tt.expectedCount {
				t.Errorf("expected %d findings, got %d", tt.expectedCount, len(findings))
			}
			if len(findings) > 0 && findings[0].RuleID != "swazz/reflected-xss" {
				t.Errorf("unexpected RuleID: %s", findings[0].RuleID)
			}
		})
	}
}
