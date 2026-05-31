package classifier

import (
	"strings"
)

// OWASPCategories returns the list of OWASP API Security Top 10 (2023) categories for a given Rule ID.
func OWASPCategories(ruleID string) []string {
	switch ruleID {
	case "swazz/bola-idor", "swazz/tenant-isolation-bypass":
		return []string{"API1:2023 Broken Object Level Authorization"}
	case "swazz/unauthorized-access":
		return []string{
			"API2:2023 Broken Authentication",
			"API5:2023 Broken Function Level Authorization",
		}
	case "swazz/sensitive-data-leak":
		return []string{"API3:2023 Broken Object Property Level Authorization"}
	case "swazz/no-rate-limit", "swazz/rate-limit-active", "swazz/response-size-anomaly":
		return []string{"API4:2023 Unrestricted Resource Consumption"}
	case "swazz/oob-interaction":
		return []string{"API10:2023 Unsafe Consumption of APIs"}
	case "swazz/cors-misconfig", "swazz/crlf-injection", "swazz/header-injection",
		"swazz/reflected-xss", "swazz/stack-trace-leak", "swazz/null-pointer-exception",
		"swazz/sql-error-leak", "swazz/rce-leak", "swazz/timeout", "swazz/network-error":
		return []string{"API8:2023 Security Misconfiguration"}
	default:
		if strings.HasPrefix(ruleID, "swazz/status-5") {
			return []string{"API8:2023 Security Misconfiguration"}
		}
		return nil
	}
}
