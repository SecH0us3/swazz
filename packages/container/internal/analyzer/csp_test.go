package analyzer

import (
	"net/http"
	"testing"
)

func TestCSPAnalyzer(t *testing.T) {
	a := &CSPAnalyzer{}

	tests := []struct {
		name          string
		headers       http.Header
		expectedRules []string
	}{
		{
			name: "HTML response missing CSP headers",
			headers: http.Header{
				"Content-Type": []string{"text/html; charset=utf-8"},
			},
			expectedRules: []string{"swazz/csp-missing"},
		},
		{
			name: "JSON response missing CSP headers (should bypass missing check)",
			headers: http.Header{
				"Content-Type": []string{"application/json"},
			},
			expectedRules: []string{},
		},
		{
			name: "HTML response with secure CSP",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{"default-src 'self'; script-src 'self'"},
			},
			expectedRules: []string{},
		},
		{
			name: "Response with wildcard source in CSP",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{"default-src *"},
			},
			expectedRules: []string{"swazz/csp-unsafe-directive"},
		},
		{
			name: "CSP with empty directive or single-part directive (should bypass check)",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{"default-src 'self';; upgrade-insecure-requests; block-all-mixed-content"},
			},
			expectedRules: []string{},
		},
		{
			name: "Response with unsafe-inline source in CSP",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{"script-src 'self' 'unsafe-inline'"},
			},
			expectedRules: []string{"swazz/csp-unsafe-directive"},
		},
		{
			name: "Response with unsafe-eval source in CSP",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{"script-src 'self' 'unsafe-eval'"},
			},
			expectedRules: []string{"swazz/csp-unsafe-directive"},
		},
		{
			name: "Response with multiple unsafe directives in CSP",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{"default-src *; script-src 'self' 'unsafe-inline'"},
			},
			expectedRules: []string{"swazz/csp-unsafe-directive", "swazz/csp-unsafe-directive"},
		},
		{
			name: "Report-Only CSP with unsafe directive",
			headers: http.Header{
				"Content-Type":                        []string{"text/html"},
				"Content-Security-Policy-Report-Only": []string{"script-src 'unsafe-inline'"},
			},
			expectedRules: []string{"swazz/csp-unsafe-directive"},
		},
		{
			name: "Multiple Content-Security-Policy headers",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{"default-src 'self'", "script-src 'self' 'unsafe-inline'"},
			},
			expectedRules: []string{"swazz/csp-unsafe-directive"},
		},
		{
			name: "Empty Content-Security-Policy header value",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{""},
			},
			expectedRules: []string{},
		},
		{
			name: "Comma-separated multiple CSP policies",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{"default-src 'self', script-src 'self' 'unsafe-inline'"},
			},
			expectedRules: []string{"swazz/csp-unsafe-directive"},
		},
		{
			name: "Style-src with unsafe-inline and unsafe-eval (should bypass error check)",
			headers: http.Header{
				"Content-Type":            []string{"text/html"},
				"Content-Security-Policy": []string{"style-src 'self' 'unsafe-inline' 'unsafe-eval'"},
			},
			expectedRules: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				ResponseHeaders: tt.headers,
			}
			findings := a.Analyze(input)

			if len(findings) != len(tt.expectedRules) {
				t.Fatalf("expected %d findings, got %d", len(tt.expectedRules), len(findings))
			}

			for i, rule := range tt.expectedRules {
				if findings[i].RuleID != rule {
					t.Errorf("expected finding %d to be %s, got %s", i, rule, findings[i].RuleID)
				}
			}
		})
	}

	t.Run("Nil checks", func(t *testing.T) {
		if findings := a.Analyze(nil); findings != nil {
			t.Errorf("expected nil findings for nil input, got %v", findings)
		}
		if findings := a.Analyze(&AnalysisInput{ResponseHeaders: nil}); findings != nil {
			t.Errorf("expected nil findings for nil headers, got %v", findings)
		}
	})
}
