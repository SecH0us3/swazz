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

// Task 61: URL exclusion matching must be case-insensitive.
func TestGlobToRegex_CaseInsensitive(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		input   string
		want    bool
	}{
		{"exact lowercase match", "/api/admin", "/api/admin", true},
		{"lowercase pattern, uppercase input", "/api/admin", "/API/ADMIN", true},
		{"uppercase pattern, lowercase input", "/API/ADMIN", "/api/admin", true},
		{"mixed case pattern", "/Api/Admin", "/api/admin", true},
		{"different path not matched", "/api/admin", "/api/users", false},
		{"wildcard single-segment case-insensitive", "/api/*", "/api/Users", true},
		{"wildcard single-segment no cross-segment", "/api/*", "/api/a/b", false},
		{"wildcard cross-segment case-insensitive", "/api/**", "/API/Users/123", true},
		{"full key case-insensitive", "GET /api/admin", "GET /api/ADMIN", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := matchesAny("", tt.input, []string{tt.pattern})
			if tt.pattern == "GET /api/admin" || tt.pattern == "GET /API/ADMIN" {
				// test key matching too
				got = matchesAny(tt.input, "", []string{tt.pattern})
			}
			if got != tt.want {
				t.Errorf("matchesAny case-insensitive(%q, %q) = %v, want %v",
					tt.pattern, tt.input, got, tt.want)
			}
		})
	}
}

func TestMatchesAny_CaseInsensitive(t *testing.T) {
	tests := []struct {
		name     string
		key      string
		path     string
		patterns []string
		want     bool
	}{
		{
			name:     "Task 61: lowercase exclude matches uppercase path",
			key:      "GET /API/ADMIN",
			path:     "/API/ADMIN",
			patterns: []string{"/api/admin"},
			want:     true,
		},
		{
			name:     "Task 61: uppercase exclude matches lowercase path",
			key:      "GET /api/admin",
			path:     "/api/admin",
			patterns: []string{"/API/ADMIN"},
			want:     true,
		},
		{
			name:     "no match on different path",
			key:      "GET /api/users",
			path:     "/api/users",
			patterns: []string{"/api/admin"},
			want:     false,
		},
		{
			name:     "wildcard matches case-insensitively",
			key:      "DELETE /API/ADMIN/USERS/123",
			path:     "/API/ADMIN/USERS/123",
			patterns: []string{"/api/admin/**"},
			want:     true,
		},
		{
			name:     "multiple patterns, second matches case-insensitively",
			key:      "POST /API/AUTH",
			path:     "/API/AUTH",
			patterns: []string{"/api/users", "/api/auth"},
			want:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := matchesAny(tt.key, tt.path, tt.patterns)
			if got != tt.want {
				t.Errorf("matchesAny(%q, %q, %v) = %v, want %v",
					tt.key, tt.path, tt.patterns, got, tt.want)
			}
		})
	}
}

