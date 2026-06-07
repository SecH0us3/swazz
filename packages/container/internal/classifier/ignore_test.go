package classifier

import (
	"os"
	"path/filepath"
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
		{Endpoint: "/api/admin/*", Method: "DELETE"},
		{Payload: "ignore-me"},
		{Payload: `^[0-9]{3}$`}, // Regex for exactly 3 digits
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
