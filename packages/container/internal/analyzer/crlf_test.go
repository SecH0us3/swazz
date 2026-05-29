package analyzer

import (
	"net/http"
	"net/http/httptest"
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
			name:          "CRLF header injection detected — raw CR only",
			payload:       "normal\rX-Injected: header",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"header"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "Double URL-encoded CRLF header injection",
			payload:       "test%250d%250aX-Injected: yes",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"yes"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "Microsoft IIS Unicode CRLF bypass",
			payload:       "test%u000d%u000aX-Injected: yes",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"yes"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "PayloadsAllTheThings UTF-8 CRLF bypass",
			payload:       "test%E5%98%8D%E5%98%8AX-Injected: yes",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"yes"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "PayloadsAllTheThings UTF-8 CRLF bypass (lowercase)",
			payload:       "test%e5%98%8d%e5%98%8aX-Injected: yes",
			response:      "",
			headers:       http.Header{"X-Injected": []string{"yes"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "Unicode literal characters CRLF bypass",
			payload:       "test\u560d\u560aX-Injected: yes",
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
			name:          "Short partial value match in header (ignored to prevent false positives)",
			payload:       "test\r\nX-Custom: yes",
			response:      "",
			headers:       http.Header{"X-Custom": []string{"yesterday"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Short exact value match in header (should match)",
			payload:       "test\r\nX-Custom: yes",
			response:      "",
			headers:       http.Header{"X-Custom": []string{"yes"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "Set-Cookie short partial value match (should match due to appended flags)",
			payload:       "test\r\nSet-Cookie: abc",
			response:      "",
			headers:       http.Header{"Set-Cookie": []string{"abc; HttpOnly"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "CORS null origin exact match",
			payload:       "null",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"null"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/header-injection",
			expectedLevel: "warning",
		},
		{
			name:          "CORS null origin false positive (payload contained null in json but ACAO is null)",
			payload:       "{\"field\": null}",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"null"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "CORS generic reflection — custom origin reflected (should not match to avoid false positives)",
			payload:       "https://myapp.example.org",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"https://myapp.example.org"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "CORS no reflection — different origin",
			payload:       "https://evil.com",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"https://trusted.example.com"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "Custom header with digit and underscore",
			payload:       "test\r\n1_custom_header: yes",
			response:      "",
			headers:       http.Header{"1_custom_header": []string{"yes"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/crlf-injection",
			expectedLevel: "error",
		},
		{
			name:          "CORS reflection generic — ACAO contains payload",
			payload:       "https://evil.com",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"https://evil.com"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/header-injection",
			expectedLevel: "warning",
		},
		{
			name:          "CORS reflection generic — payload contains ACAO but no reflection (should not match)",
			payload:       "https://trusted.example.com.evil.com",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"https://trusted.example.com"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "CORS reflection false positive — ACAO is trusted subdomain containing malicious domain suffix (should not match)",
			payload:       "https://evil.com",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"https://evil.com.example.com"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 0,
		},
		{
			name:          "CORS reflection subdomain of malicious domain (should match)",
			payload:       "https://evil.com",
			response:      "",
			headers:       http.Header{"Access-Control-Allow-Origin": []string{"https://sub.evil.com"}},
			profile:       swagger.ProfileMalicious,
			expectedCount: 1,
			expectedRule:  "swazz/header-injection",
			expectedLevel: "warning",
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
		{"Double URL-encoded (decoded)", "test%250d%250aX-Injected: value", 1},
		{"Raw CR single header", "test\rX-Injected: value", 1},
		{"URL-encoded query CRLF with space as plus", "test%0d%0aX-Injected:+value+with+spaces", 2},
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
		{"CR only", "before\rafter", 1},
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

func TestCRLFAnalyzer_Integration(t *testing.T) {
	// Start a mock vulnerable HTTP server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))
	defer server.Close()

	// Make a request with a suspicious Origin header
	client := &http.Client{}
	req, err := http.NewRequest("GET", server.URL, nil)
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}

	suspiciousOrigin := "https://attacker.com"
	req.Header.Set("Origin", suspiciousOrigin)

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("failed to execute request: %v", err)
	}
	defer resp.Body.Close()

	// Run CRLFAnalyzer on the actual HTTP response
	analyzer := NewCRLFAnalyzer()
	input := &AnalysisInput{
		SentPayload:     suspiciousOrigin, // simulating the fuzzer injecting the origin
		ResponseHeaders: resp.Header,
		Profile:         swagger.ProfileMalicious,
	}

	findings := analyzer.Analyze(input)
	if len(findings) != 1 {
		t.Fatalf("expected 1 finding from CORS origin reflection, got %d", len(findings))
	}

	finding := findings[0]
	if finding.RuleID != "swazz/header-injection" {
		t.Errorf("expected rule ID 'swazz/header-injection', got '%s'", finding.RuleID)
	}
	if finding.Level != "warning" {
		t.Errorf("expected warning level, got '%s'", finding.Level)
	}
}

