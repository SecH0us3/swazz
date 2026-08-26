// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import "testing"

func TestContainsFoldASCII(t *testing.T) {
	tests := []struct {
		haystack string
		needle   string
		expected bool
	}{
		{"Hello World", "world", true},
		{"Hello World", "WORLD", true},
		{"Hello World", "hello", true},
		{"Hello World", "lo wo", true},
		{"Hello World", "foo", false},
		{"", "foo", false},
		{"Hello", "", true},
		{"SQL error in syntax", "error", true},
		{"SQL error in syntax", "SQL", true},
		{"SQL error in syntax", "ORA-", false},
	}

	for _, tt := range tests {
		got := containsFoldASCII([]byte(tt.haystack), tt.needle)
		if got != tt.expected {
			t.Errorf("containsFoldASCII(%q, %q) = %v; want %v", tt.haystack, tt.needle, got, tt.expected)
		}
	}
}

func TestContainsAnyFoldASCII(t *testing.T) {
	haystack := []byte(`{"status": "ok", "message": "success"}`)
	if containsAnyFoldASCII(haystack, "error", "syntax", "sql") {
		t.Errorf("expected clean response not to match error terms")
	}

	errHaystack := []byte(`{"error": "MySQL syntax error near 'x'"}`)
	if !containsAnyFoldASCII(errHaystack, "error", "syntax", "sql") {
		t.Errorf("expected error response to match error terms")
	}
}
