package main

import "testing"

func TestGlobToRegex(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		input   string
		want    bool
	}{
		// ** crosses path separators
		{"double-star crosses segments", "**/callback/**", "/api/tm/buffy/callback/aml", true},
		// * stays within a single segment
		{"single-star within segment", "/api/*/ping", "/api/svc/ping", true},
		{"single-star does not cross segments", "/api/*/ping", "/api/a/b/ping", false},
		// ** at leading position
		{"double-star prefix deep path", "**/webhook", "/api/tm/partner/intercom/webhook", true},
		// literal braces are treated as literals, not regex groups
		{"literal braces in path", "/api/tm/refenetiveTest/*", "/api/tm/refenetiveTest/{x}", true},
		// sanity: exact match without wildcards
		{"exact match no wildcard", "/health", "/health", true},
		{"exact mismatch no wildcard", "/health", "/ready", false},
		// dots in patterns are literal
		{"dot is literal", "/v1.0/ping", "/v1.0/ping", true},
		{"dot is not regex dot", "/v1.0/ping", "/v100/ping", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := matchesAny("", tt.input, []string{tt.pattern})
			if got != tt.want {
				t.Errorf("matchesAny(%q, %q, [%q]) = %v, want %v",
					"", tt.input, tt.pattern, got, tt.want)
			}
		})
	}
}

func TestMatchesAny_KeyAndPath(t *testing.T) {
	// matchesAny tests both the key ("METHOD /path") and the path string.
	// Path-only patterns (e.g. /api/*/users) are matched against the path arg.
	pathPatterns := []string{"/api/*/users"}

	// Path matches the pattern directly.
	if !matchesAny("GET /other", "/api/v1/users", pathPatterns) {
		t.Error("expected path /api/v1/users to match pattern /api/*/users")
	}
	// Neither key ("GET /health") nor path ("/health") matches.
	if matchesAny("GET /health", "/health", pathPatterns) {
		t.Error("expected no match for /health against /api/*/users")
	}

	// Test key matching with a pattern that covers the full "METHOD /path" key.
	keyPatterns := []string{"GET /api/*/users"}
	if !matchesAny("GET /api/v2/users", "/other", keyPatterns) {
		t.Error("expected key 'GET /api/v2/users' to match pattern 'GET /api/*/users'")
	}
	// Space in key pattern is treated as literal (QuoteMeta escapes spaces harmlessly).
	if matchesAny("POST /api/v2/users", "/other", keyPatterns) {
		t.Error("expected no match: method mismatch POST vs GET")
	}
}
