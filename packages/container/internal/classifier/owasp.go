package classifier

import (
	"strings"
)

// OWASPCategories returns the list of OWASP Top 10 (2025) categories for a given Rule ID.
func OWASPCategories(ruleID string) []string {
	switch ruleID {
	case "swazz/bola-idor", "swazz/tenant-isolation-bypass":
		return []string{"A01:2025 Broken Access Control"}
	case "swazz/unauthorized-access":
		return []string{
			"A07:2025 Authentication Failures",
			"A01:2025 Broken Access Control",
		}
	case "swazz/sensitive-data-leak":
		return []string{"A01:2025 Broken Access Control"}
	case "swazz/no-rate-limit", "swazz/rate-limit-active", "swazz/response-size-anomaly":
		return []string{"A06:2025 Insecure Design"}
	case "swazz/oob-interaction":
		return []string{"A08:2025 Software or Data Integrity Failures"}
	case "swazz/cors-misconfig", "swazz/csp-missing", "swazz/csp-unsafe-directive":
		return []string{"A02:2025 Security Misconfiguration"}
	case "swazz/crlf-injection", "swazz/header-injection", "swazz/reflected-xss", "swazz/rce-leak",
		"swazz/time-based-sqli", "swazz/time-based-cmdi":
		return []string{"A05:2025 Injection"}
	case "swazz/stack-trace-leak", "swazz/null-pointer-exception", "swazz/sql-error-leak",
		"swazz/timeout", "swazz/network-error":
		return []string{"A10:2025 Mishandling of Exceptional Conditions"}
	default:
		if strings.HasPrefix(ruleID, "swazz/status-5") {
			return []string{"A10:2025 Mishandling of Exceptional Conditions"}
		}
		return nil
	}
}
