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

// mergeTaxonomy returns the union of two classification lists, preserving the
// order of the first and appending anything the second adds. Duplicates drop out.
func mergeTaxonomy(primary, fallback []string) []string {
	if len(primary) == 0 {
		return fallback
	}
	if len(fallback) == 0 {
		return primary
	}
	seen := make(map[string]bool, len(primary)+len(fallback))
	out := make([]string, 0, len(primary)+len(fallback))
	for _, list := range [][]string{primary, fallback} {
		for _, v := range list {
			if !seen[v] {
				seen[v] = true
				out = append(out, v)
			}
		}
	}
	return out
}

// ResolveTaxonomy returns the OWASP Web (2025), OWASP API (2023) and CWE
// identifiers to attach to an analyzer finding.
//
// These are multi-valued classification lists, so the analyzer's own mapping and
// the rule-ID tables are merged rather than one replacing the other:
//
//   - Recomputing everything from the rule ID drops the mapping the analyzer set.
//     28 rule IDs (prototype pollution, NoSQL injection, SSRF cloud metadata, JWT
//     and DPoP tampering, mass assignment, gRPC, differential BOLA) have no table
//     entry at all, so their findings used to arrive with no OWASP category.
//   - Taking only the analyzer's mapping drops what the tables add. No analyzer
//     emits API10:2023, so preferring the analyzer's API8:2023 alone would empty
//     the API10 card for sql-error-leak, reflected-xss, cmdi-leak, ssti-leak and
//     xxe-leak.
func ResolveTaxonomy(f *swagger.AnalysisFinding, method, endpoint string) (owaspWeb, owaspAPI, cweIDs []string) {
	owaspWeb = mergeTaxonomy(f.OWASPCategory, OWASPCategories(f.RuleID))
	owaspAPI = mergeTaxonomy(f.OWASPAPICategory, OWASPAPICategories(f.RuleID, method, endpoint, f.Evidence))
	cweIDs = mergeTaxonomy(f.CWEIDs, CWEIdentifiers(f.RuleID, method, endpoint, f.Evidence))
	return owaspWeb, owaspAPI, cweIDs
}
