// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package classifier

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"

	"swazz-engine/internal/swagger"
)

func TestOWASPCategories(t *testing.T) {
	tests := []struct {
		ruleID   string
		expected []string
	}{
		{"swazz/bola-idor", []string{"A01:2025 Broken Access Control"}},
		{"swazz/tenant-isolation-bypass", []string{"A01:2025 Broken Access Control"}},
		{"swazz/unauthorized-access", []string{"A07:2025 Authentication Failures", "A01:2025 Broken Access Control"}},
		{"swazz/sensitive-data-leak", []string{"A01:2025 Broken Access Control"}},
		{"swazz/no-rate-limit", []string{"A06:2025 Insecure Design"}},
		{"swazz/rate-limit-active", []string{"A06:2025 Insecure Design"}},
		{"swazz/response-size-anomaly", []string{"A06:2025 Insecure Design"}},
		{"swazz/oob-interaction", []string{"A08:2025 Software or Data Integrity Failures"}},
		{"swazz/cors-misconfig", []string{"A02:2025 Security Misconfiguration"}},
		{"swazz/csp-missing", []string{"A02:2025 Security Misconfiguration"}},
		{"swazz/csp-unsafe-directive", []string{"A02:2025 Security Misconfiguration"}},
		{"swazz/crlf-injection", []string{"A05:2025 Injection"}},
		{"swazz/header-injection", []string{"A05:2025 Injection"}},
		{"swazz/reflected-xss", []string{"A05:2025 Injection"}},
		{"swazz/rce-leak", []string{"A05:2025 Injection"}},
		{"swazz/time-based-sqli", []string{"A05:2025 Injection"}},
		{"swazz/time-based-cmdi", []string{"A05:2025 Injection"}},
		{"swazz/stack-trace-leak", []string{"A10:2025 Mishandling of Exceptional Conditions"}},
		{"swazz/null-pointer-exception", []string{"A10:2025 Mishandling of Exceptional Conditions"}},
		{"swazz/sql-error-leak", []string{"A10:2025 Mishandling of Exceptional Conditions"}},
		{"swazz/timeout", []string{"A10:2025 Mishandling of Exceptional Conditions"}},
		{"swazz/network-error", []string{"A10:2025 Mishandling of Exceptional Conditions"}},
		{"swazz/status-500", []string{"A10:2025 Mishandling of Exceptional Conditions"}},
		{"swazz/status-503", []string{"A10:2025 Mishandling of Exceptional Conditions"}},
		{"swazz/status-200", nil},
		{"unknown-rule", nil},
	}

	for _, tt := range tests {
		t.Run(tt.ruleID, func(t *testing.T) {
			got := OWASPCategories(tt.ruleID)
			if !reflect.DeepEqual(got, tt.expected) {
				t.Errorf("OWASPCategories(%s) = %v; want %v", tt.ruleID, got, tt.expected)
			}
		})
	}
}

func TestResolveTaxonomyPrefersAnalyzerValues(t *testing.T) {
	// swazz/prototype-pollution has no entry in the rule-ID lookup tables, so
	// recomputing its taxonomy used to blank out the mapping the analyzer set.
	af := swagger.AnalysisFinding{
		RuleID:           "swazz/prototype-pollution",
		OWASPCategory:    []string{"A08:2025 Software or Data Integrity Failures"},
		OWASPAPICategory: []string{"API3:2023 Broken Object Property Level Authorization"},
		CWEIDs:           []string{"CWE-1321"},
	}

	web, api, cwe := ResolveTaxonomy(&af, "POST", "/api/users")

	assert.Equal(t, []string{"A08:2025 Software or Data Integrity Failures"}, web)
	assert.Equal(t, []string{"API3:2023 Broken Object Property Level Authorization"}, api)
	assert.Equal(t, []string{"CWE-1321"}, cwe)
}

func TestResolveTaxonomyFallsBackToRuleTables(t *testing.T) {
	af := swagger.AnalysisFinding{RuleID: "swazz/reflected-xss"}

	web, api, cwe := ResolveTaxonomy(&af, "GET", "/search")

	assert.Equal(t, OWASPCategories("swazz/reflected-xss"), web)
	assert.Equal(t, OWASPAPICategories("swazz/reflected-xss", "GET", "/search", ""), api)
	assert.Equal(t, CWEIdentifiers("swazz/reflected-xss", "GET", "/search", ""), cwe)
	assert.NotEmpty(t, web)
}
