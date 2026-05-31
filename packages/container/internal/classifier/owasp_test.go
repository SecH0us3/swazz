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
		{"swazz/bola-idor", []string{"API1:2023 Broken Object Level Authorization"}},
		{"swazz/tenant-isolation-bypass", []string{"API1:2023 Broken Object Level Authorization"}},
		{"swazz/unauthorized-access", []string{"API2:2023 Broken Authentication", "API5:2023 Broken Function Level Authorization"}},
		{"swazz/sensitive-data-leak", []string{"API3:2023 Broken Object Property Level Authorization"}},
		{"swazz/no-rate-limit", []string{"API4:2023 Unrestricted Resource Consumption"}},
		{"swazz/rate-limit-active", []string{"API4:2023 Unrestricted Resource Consumption"}},
		{"swazz/response-size-anomaly", []string{"API4:2023 Unrestricted Resource Consumption"}},
		{"swazz/oob-interaction", []string{"API10:2023 Unsafe Consumption of APIs"}},
		{"swazz/cors-misconfig", []string{"API8:2023 Security Misconfiguration"}},
		{"swazz/crlf-injection", []string{"API8:2023 Security Misconfiguration"}},
		{"swazz/header-injection", []string{"API8:2023 Security Misconfiguration"}},
		{"swazz/reflected-xss", []string{"API8:2023 Security Misconfiguration"}},
		{"swazz/stack-trace-leak", []string{"API8:2023 Security Misconfiguration"}},
		{"swazz/null-pointer-exception", []string{"API8:2023 Security Misconfiguration"}},
		{"swazz/sql-error-leak", []string{"API8:2023 Security Misconfiguration"}},
		{"swazz/status-500", []string{"API8:2023 Security Misconfiguration"}},
		{"swazz/status-503", []string{"API8:2023 Security Misconfiguration"}},
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
