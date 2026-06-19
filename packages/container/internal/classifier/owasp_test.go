package classifier

import (
	"reflect"
	"testing"
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
		{"swazz/crlf-injection", []string{"A05:2025 Injection"}},
		{"swazz/header-injection", []string{"A05:2025 Injection"}},
		{"swazz/reflected-xss", []string{"A05:2025 Injection"}},
		{"swazz/rce-leak", []string{"A05:2025 Injection"}},
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
