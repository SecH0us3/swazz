// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package classifier

import (
	"strings"

	"swazz-engine/internal/swagger"
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
	case "swazz/cors-misconfig", "swazz/csp-missing", "swazz/csp-unsafe-directive",
		"swazz/hsts-missing", "swazz/hsts-insecure",
		"swazz/x-frame-options-missing", "swazz/x-frame-options-insecure",
		"swazz/x-content-type-options-missing", "swazz/x-content-type-options-insecure",
		"swazz/server-header-leak", "swazz/x-powered-by-leak", "swazz/x-aspnet-version-leak":
		return []string{"A02:2025 Security Misconfiguration"}
	case "swazz/crlf-injection", "swazz/header-injection", "swazz/reflected-xss", "swazz/rce-leak",
		"swazz/time-based-sqli", "swazz/time-based-cmdi":
		return []string{"A05:2025 Injection"}
	case "swazz/stack-trace-leak", "swazz/null-pointer-exception", "swazz/sql-error-leak",
		"swazz/timeout", "swazz/network-error", "swazz/mcp-server-crash":
		return []string{"A10:2025 Mishandling of Exceptional Conditions"}
	case "swazz/mcp-tool-error-reflection":
		return []string{"A05:2025 Injection"}
	default:
		if strings.HasPrefix(ruleID, "swazz/status-5") {
			return []string{"A10:2025 Mishandling of Exceptional Conditions"}
		}
		return nil
	}
}

// ResolveTaxonomy returns the OWASP Web (2025), OWASP API (2023) and CWE
// identifiers to attach to an analyzer finding.
//
// Analyzers that already carry their own taxonomy (the 2026 core analyzers —
// prototype pollution, NoSQL injection, SSRF, JWT, mass assignment, gRPC,
// WebSocket, differential BOLA — all do) keep it: those mappings are more
// precise than a rule-ID lookup and several of those rule IDs have no lookup
// entry at all, so recomputing them unconditionally silently dropped the
// compliance mapping from reports and the dashboard. Only empty fields fall
// back to the rule-ID tables.
func ResolveTaxonomy(f *swagger.AnalysisFinding, method, endpoint string) (owaspWeb, owaspAPI, cweIDs []string) {
	owaspWeb = f.OWASPCategory
	if len(owaspWeb) == 0 {
		owaspWeb = OWASPCategories(f.RuleID)
	}
	owaspAPI = f.OWASPAPICategory
	if len(owaspAPI) == 0 {
		owaspAPI = OWASPAPICategories(f.RuleID, method, endpoint, f.Evidence)
	}
	cweIDs = f.CWEIDs
	if len(cweIDs) == 0 {
		cweIDs = CWEIdentifiers(f.RuleID, method, endpoint, f.Evidence)
	}
	return owaspWeb, owaspAPI, cweIDs
}
