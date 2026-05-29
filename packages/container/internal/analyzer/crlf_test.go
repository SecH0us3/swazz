package analyzer

import (
	"net/http"
	"swazz-engine/internal/swagger"
	"testing"
)

func TestCRLFAnalyzer(t *testing.T) {
	a := NewCRLFAnalyzer()

	tests := []struct {
		name          string
		payload       any
		response      string
		headers       http.Header
		profile       swagger.FuzzingProfile
		expectedCount int
		expectedRule  string
		expectedLevel string
	}{
		{
			name:          "CRLF header injection detected — raw CRLF",
			payload:       "normal\r\nX-Injected: header",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"header"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "Set-Cookie injection detected",
			payload:       "value\r\nSet-Cookie: evil=true",
			response:      "",
			headers:       http.Header{"Set-Cookie": []string{"evil=true"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "URL-encoded CRLF header injection",
			payload:       "test%0d%0aX-Injected: yes",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"yes"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "HTTP response splitting — Content-Length injection",
			payload:       "test\r\nContent-Length: 0\r\n\r\n",
			response:      "",
			headers:       http.Header{"Content-Length": []string{"0"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "CORS reflection detected — evil.com",
			payload:       "https://evil.com",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"https://evil.com"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/header-injection",
			expectedLevel: "warning",
		},
		{
			name:          "CORS reflection detected — null origin",
			payload:       "null",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"null"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/header-injection",
			expectedLevel: "warning",
		},
		{
			name:          "No injection — clean response headers",
			payload:       "normal\r\nX-Injected: header",
			response:      "",
			headers:       http.Header{"Content-Type": []string{"application/json"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Non-malicious profile should be ignored",
			payload:       "normal\r\nX-Injected: header",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"header"}},
			profile:       swagger.ProfileRandom,
			expectedCount: 0,
		},
		{
			name:          "Boundary profile should be ignored",
			payload:       "normal\r\nX-Injected: header",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"header"}},
			profile:       swagger.ProfileBoundary,
			expectedCount: 0,
		},
		{
			name:          "Nil headers — no panic",
			payload:       "normal\r\nX-Injected: header",
			response:      "",
			headers:       nil,
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Empty payload — no findings",
			payload:       "",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"header"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Nil payload — no findings",
			payload:       nil,
			response:      "",
			headers:       http.Header{"X-Injected": []string{"header"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "False positive: normal Set-Cookie from server",
			payload:       "\r\n\r\n",
			response:      "",
			headers:       http.Header{"Set-Cookie": []string{"session=abc123; HttpOnly"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Go net/http CRLF protection — headers stripped",
			payload:       "normal\r\nX-Injected: header",
			response:      "",
			headers:       http.Header{"Content-Type": []string{"text/html"}}, // Go strips injected headers
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Multiple injected headers",
			payload:       "normal\r\nX-First: one\r\nX-Second: two",
			response:      "",
			headers:       http.Header{"X-First": []string{"one"}, "X-Second": []string{"two"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 2,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "Map payload with nested CRLF string",
			payload:       map[string]any{"param": "test\r\nX-Injected: frommap"},
			response:      "",
			headers:       http.Header{"X-Injected": []string{"frommap"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "Slice payload with CRLF string",
			payload:       []any{"test\r\nX-Evil: injected"},
			response:      "",
			headers:       http.Header{"X-Evil": []string{"injected"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "CORS wildcard — not a vulnerability",
			payload:       "https://evil.com",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"*"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Payload with only CRLF — no header name:value",
			payload:       "\r\n",
			response:      "",
			headers:       http.Header{"Content-Type": []string{"text/html"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Case-insensitive header matching",
			payload:       "test\r\nX-INJECTED: value",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"value"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "Partial value match in header",
			payload:       "test\r\nX-Custom: partial",
			response:      "",
			headers:       http.Header{"X-Custom": []string{"partial-but-longer-value"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "CORS generic reflection — custom origin reflected",
			payload:       "https://myapp.example.org",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"https://myapp.example.org"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/header-injection",
			expectedLevel: "warning",
		},
		{
			name:          "CORS no reflection — different origin",
			payload:       "https://evil.com",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"https://trusted.example.com"}},
			profile:       swagger.ProfileMalicious,
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
				t.Errorf("expected %d findings, got %d: %+v", tt.expectedCount, len(findings), findings)
			}
			if tt.expectedCount > 0 && len(findings) > 0 {
				if tt.expectedRule != "" && findings[0].RuleID != tt.expectedRule {
					t.Errorf("expected RuleID %q, got %q", tt.expectedRule, findings[0].RuleID)
				}
				if tt.expectedLevel != "" && findings[0].Level != tt.expectedLevel {
					t.Errorf("expected Level %q, got %q", tt.expectedLevel, findings[0].Level)
				}
				if findings[0].Evidence == "" {
					t.Error("expected non-empty Evidence")
				}
				if findings[0].Message == "" {
					t.Error("expected non-empty Message")
				}
			}
		})
	}
}

func TestCRLFAnalyzer_ExtractInjectedHeaders(t *testing.T) {
	a := NewCRLFAnalyzer()

	tests := []struct {
		name     string
		payload  string
		expected int
	}{
		{"Raw CRLF single header", "test\r\nX-Injected: value", 1},
		{"Raw CRLF multiple headers", "test\r\nX-First: one\r\nX-Second: two", 2},
		{"URL-encoded CRLF", "test%0d%0aX-Injected: value", 1},
		{"No CRLF", "plain text payload", 0},
		{"CRLF without header format", "\r\n\r\n", 0},
		{"Empty string", "", 0},
		{"Set-Cookie injection", "test\r\nSet-Cookie: evil=true", 1},
		{"Double URL-encoded (not decoded)", "test%250d%250aX-Injected: value", 0}, // double-encoded should NOT match
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			headers := a.extractInjectedHeaders(tt.payload)
			if len(headers) != tt.expected {
				t.Errorf("expected %d injected headers, got %d: %+v", tt.expected, len(headers), headers)
			}
		})
	}
}

func TestCRLFAnalyzer_SplitOnCRLF(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int // number of parts after first CRLF
	}{
		{"Raw CRLF", "before\r\nafter", 1},
		{"Multiple CRLF", "before\r\nmid\r\nafter", 2},
		{"No CRLF", "no crlf here", 0},
		{"LF only", "before\nafter", 1},
		{"Empty", "", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parts := splitOnCRLF(tt.input)
			if len(parts) != tt.expected {
				t.Errorf("expected %d parts, got %d: %v", tt.expected, len(parts), parts)
			}
		})
	}
}
