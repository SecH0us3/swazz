package classifier

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

func TestLoadIgnoreRules(t *testing.T) {
	// 1. Non-existent file should return nil, nil
	rules, err := LoadIgnoreRules("non_existent_file.json")
	if err != nil {
		t.Fatalf("unexpected error for non-existent file: %v", err)
	}
	if len(rules) != 0 {
		t.Errorf("expected 0 rules, got %d", len(rules))
	}

	// Create temp directory for valid/invalid files
	tempDir, err := os.MkdirTemp("", "swazz-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// 2. Valid ignore JSON file
	validPath := filepath.Join(tempDir, "swazz.ignore.json")
	validJSON := `[
		{"rule_id": "swazz/reflected-xss", "endpoint": "/api/users/*"},
		{"method": "POST", "payload": ".*select.*"}
	]`
	if err := os.WriteFile(validPath, []byte(validJSON), 0600); err != nil {
		t.Fatalf("failed to write valid json: %v", err)
	}

	rules, err = LoadIgnoreRules(validPath)
	if err != nil {
		t.Fatalf("unexpected error reading valid ignore rules: %v", err)
	}
	if len(rules) != 2 {
		t.Fatalf("expected 2 rules, got %d", len(rules))
	}
	if rules[0].RuleID != "swazz/reflected-xss" || rules[0].Endpoint != "/api/users/*" {
		t.Errorf("rule 0 mismatch: %+v", rules[0])
	}
	if rules[1].Method != "POST" || rules[1].Payload != ".*select.*" {
		t.Errorf("rule 1 mismatch: %+v", rules[1])
	}

	// 3. Invalid ignore JSON file
	invalidPath := filepath.Join(tempDir, "swazz.invalid.json")
	invalidJSON := `[{"rule_id": "swazz/reflected-xss",`
	if err := os.WriteFile(invalidPath, []byte(invalidJSON), 0600); err != nil {
		t.Fatalf("failed to write invalid json: %v", err)
	}

	_, err = LoadIgnoreRules(invalidPath)
	if err == nil {
		t.Error("expected error reading invalid JSON, got nil")
	}
}

func TestIsIgnored(t *testing.T) {
	rules := []IgnoreRule{
		{RuleID: "swazz/reflected-xss", Endpoint: "/api/search"},
		// ** is required to cross path segments; the old HasPrefix implementation
		// silently behaved like **, so we update the pattern to be explicit.
		{Endpoint: "/api/admin/**", Method: "DELETE"},
		{Payload: "ignore-me"},
		{Payload: `^[0-9]{3}$`}, // Regex for exactly 3 digits
		{Payload: `"testkey":"testval"`},
	}
	for i := range rules {
		if rules[i].Payload != "" {
			rules[i].payloadRx, _ = regexp.Compile(rules[i].Payload)
		}
	}

	tests := []struct {
		name     string
		finding  *Finding
		expected bool
	}{
		{
			name:     "nil finding is not ignored",
			finding:  nil,
			expected: false,
		},
		{
			name: "matches rule 0 exactly",
			finding: &Finding{
				RuleID:   "swazz/reflected-xss",
				Endpoint: "/api/search",
			},
			expected: true,
		},
		{
			name: "rule 0 rule_id matches but endpoint does not",
			finding: &Finding{
				RuleID:   "swazz/reflected-xss",
				Endpoint: "/api/users",
			},
			expected: false,
		},
		{
			name: "matches rule 1 wildcard endpoint and method",
			finding: &Finding{
				Endpoint: "/api/admin/users/123",
				Method:   "DELETE",
			},
			expected: true,
		},
		{
			name: "rule 1 endpoint matches but method does not",
			finding: &Finding{
				Endpoint: "/api/admin/users",
				Method:   "GET",
			},
			expected: false,
		},
		{
			name: "matches rule 2 payload substring",
			finding: &Finding{
				Payload: "this contains ignore-me payload",
			},
			expected: true,
		},
		{
			name: "matches rule 2 payload substring in byte slice",
			finding: &Finding{
				Payload: []byte("this contains ignore-me payload"),
			},
			expected: true,
		},
		{
			name: "matches rule 3 payload regex",
			finding: &Finding{
				Payload: "123",
			},
			expected: true,
		},
		{
			name: "rule 3 regex does not match payload",
			finding: &Finding{
				Payload: "1234",
			},
			expected: false,
		},
		{
			name: "matches rule 4 with complex map payload serialized to json",
			finding: &Finding{
				Payload: map[string]any{"testkey": "testval"},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsIgnored(tt.finding, rules)
			if got != tt.expected {
				t.Errorf("IsIgnored() = %v, want %v", got, tt.expected)
			}
		})
	}
}

// TestEndpointGlobToRegex exercises the glob engine used in IgnoreRule.Endpoint.
func TestEndpointGlobToRegex(t *testing.T) {
	tests := []struct {
		pattern  string
		endpoint string
		want     bool
	}{
		// ** crosses path separators
		{"**/callback/**", "/api/tm/buffy/callback/aml", true},
		{"**/webhook", "/api/partner/intercom/webhook", true},
		// * stays within a single segment
		{"/api/*/users", "/api/v1/users", true},
		{"/api/*/users", "/api/a/b/users", false}, // two segments — no match
		// exact match (no wildcards)
		{"/health", "/health", true},
		{"/health", "/ready", false},
		// trailing * (previously the only supported style — must still work)
		{"/api/admin/*", "/api/admin/users", true},
		{"/api/admin/*", "/api/admin/users/123", false}, // * does not cross /
		// ** at end
		{"/api/admin/**", "/api/admin/users/123", true},
		// literal dot in endpoint path
		{"/v1.0/ping", "/v1.0/ping", true},
		{"/v1.0/ping", "/v100/ping", false}, // dot is literal, not regex .
	}

	for _, tt := range tests {
		got := endpointMatches(tt.pattern, tt.endpoint)
		if got != tt.want {
			t.Errorf("endpointMatches(%q, %q) = %v, want %v",
				tt.pattern, tt.endpoint, got, tt.want)
		}
	}
}

// TestIsIgnored_GlobEndpoint verifies that glob patterns in IgnoreRule.Endpoint
// work end-to-end through IsIgnored — covering the patterns that were silently
// broken with the old HasSuffix/HasPrefix implementation.
func TestIsIgnored_GlobEndpoint(t *testing.T) {
	rules := []IgnoreRule{
		{RuleID: "swazz/status-200", Endpoint: "**/callback/**"},
		{Endpoint: "/api/*/ping"},
		{Endpoint: "/api/admin/**", Method: "DELETE"},
	}

	tests := []struct {
		name    string
		finding *Finding
		want    bool
	}{
		{
			name:    "** crosses segments (deep callback path)",
			finding: &Finding{RuleID: "swazz/status-200", Endpoint: "/api/tm/buffy/callback/aml"},
			want:    true,
		},
		{
			name:    "** rule does not match unrelated endpoint",
			finding: &Finding{RuleID: "swazz/status-200", Endpoint: "/api/tm/users"},
			want:    false,
		},
		{
			name:    "single-segment * matches",
			finding: &Finding{Endpoint: "/api/v2/ping"},
			want:    true,
		},
		{
			name:    "single-segment * does not match two segments",
			finding: &Finding{Endpoint: "/api/v2/extra/ping"},
			want:    false,
		},
		{
			name:    "** with method constraint matches",
			finding: &Finding{Endpoint: "/api/admin/roles/123", Method: "DELETE"},
			want:    true,
		},
		{
			name:    "** with method constraint does not match wrong method",
			finding: &Finding{Endpoint: "/api/admin/roles/123", Method: "GET"},
			want:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsIgnored(tt.finding, rules)
			if got != tt.want {
				t.Errorf("IsIgnored() = %v, want %v", got, tt.want)
			}
		})
	}
}
