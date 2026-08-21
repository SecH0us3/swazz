// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package classifier

import (
	"regexp"
	"sort"
	"strings"
)

// ClassificationContext encapsulates all metadata required to classify a finding.
type ClassificationContext struct {
	RuleID       string            `json:"ruleId"`
	Method       string            `json:"method,omitempty"`
	Endpoint     string            `json:"endpoint,omitempty"`
	ResolvedPath string            `json:"resolvedPath,omitempty"`
	Payload      any               `json:"payload,omitempty"`
	ResponseBody any               `json:"responseBody,omitempty"`
	Status       int               `json:"status,omitempty"`
	Headers      map[string]string `json:"headers,omitempty"`
	Evidence     string            `json:"evidence,omitempty"`
}

// ClassificationMatch represents a weighted category assignment with reasoning.
type ClassificationMatch struct {
	Category   string  `json:"category"`   // e.g. "API1:2023 Broken Object Level Authorization"
	Standard   string  `json:"standard"`   // "OWASP_API_2023" | "OWASP_WEB_2025" | "CWE"
	Weight     float64 `json:"weight"`     // 0.0 - 1.0
	Confidence string  `json:"confidence"` // "CERTAIN", "HIGH", "MEDIUM", "TENTATIVE"
	Reason     string  `json:"reason"`
	CWE        string  `json:"cwe,omitempty"`
}

var (
	uuidRegex   = regexp.MustCompile(`(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
	objIdRegex  = regexp.MustCompile(`(?i)\{[a-z0-9_]*id[a-z0-9_]*\}|/:[a-z0-9_]*id[a-z0-9_]*|/[0-9]+(/|$)`)
	authPathRx  = regexp.MustCompile(`(?i)/auth|/login|/signin|/register|/signup|/password|/reset|/otp|/2fa|/token|/payment|/checkout|/transfer|/billing|/order|/session`)
	adminPathRx = regexp.MustCompile(`(?i)/admin|/internal|/manage|/system|/config|/root|/roles|/permissions|/superuser`)
	assetPathRx = regexp.MustCompile(`(?i)/v[0-9]+/|/beta|/legacy|/old|/deprecated|/debug|/actuator|/metrics|/swagger|/graphi?ql`)
)

func isSensitiveAuthOrBusinessFlow(path string) bool {
	return authPathRx.MatchString(path)
}

func isAdminOrPrivilegedPath(path string) bool {
	return adminPathRx.MatchString(path)
}

func hasObjectIdentifier(path string) bool {
	return objIdRegex.MatchString(path) || uuidRegex.MatchString(path)
}

func isDeprecatedOrAssetPath(path string) bool {
	return assetPathRx.MatchString(path)
}

// EvaluateOWASPAPI runs the weighted classification engine across all OWASP API Security Top 10 (2023) rules.
func EvaluateOWASPAPI(ctx *ClassificationContext) []ClassificationMatch {
	if ctx == nil || ctx.RuleID == "" {
		return nil
	}

	var matches []ClassificationMatch
	ruleID := ctx.RuleID
	path := ctx.Endpoint
	if path == "" {
		path = ctx.ResolvedPath
	}
	evidenceLower := strings.ToLower(ctx.Evidence)

	// API1:2023 Broken Object Level Authorization (BOLA / IDOR)
	if ruleID == "swazz/bola-idor" || ruleID == "swazz/tenant-isolation-bypass" {
		if hasObjectIdentifier(path) {
			matches = append(matches, ClassificationMatch{
				Category:   "API1:2023 Broken Object Level Authorization",
				Standard:   "OWASP_API_2023",
				Weight:     1.0,
				Confidence: "CERTAIN",
				Reason:     "Direct object reference parameter allowed unauthorized access to foreign resource",
				CWE:        "CWE-639",
			})
		} else {
			matches = append(matches, ClassificationMatch{
				Category:   "API1:2023 Broken Object Level Authorization",
				Standard:   "OWASP_API_2023",
				Weight:     0.9,
				Confidence: "HIGH",
				Reason:     "Cross-tenant / unauthorized object access detected without strict owner validation",
				CWE:        "CWE-284",
			})
		}
	}

	// API2:2023 Broken Authentication
	if ruleID == "swazz/unauthorized-access" || ruleID == "swazz/weak-token" {
		if isSensitiveAuthOrBusinessFlow(path) {
			matches = append(matches, ClassificationMatch{
				Category:   "API2:2023 Broken Authentication",
				Standard:   "OWASP_API_2023",
				Weight:     0.98,
				Confidence: "CERTAIN",
				Reason:     "Authentication bypassed or missing on critical authentication flow",
				CWE:        "CWE-287",
			})
		} else {
			matches = append(matches, ClassificationMatch{
				Category:   "API2:2023 Broken Authentication",
				Standard:   "OWASP_API_2023",
				Weight:     0.85,
				Confidence: "HIGH",
				Reason:     "Unauthenticated request was accepted by a protected endpoint",
				CWE:        "CWE-306",
			})
		}
	} else if ruleID == "swazz/sensitive-data-leak" && (strings.Contains(evidenceLower, "jwt") || strings.Contains(evidenceLower, "token") || strings.Contains(evidenceLower, "key") || strings.Contains(evidenceLower, "secret")) {
		matches = append(matches, ClassificationMatch{
			Category:   "API2:2023 Broken Authentication",
			Standard:   "OWASP_API_2023",
			Weight:     0.92,
			Confidence: "HIGH",
			Reason:     "Session tokens, API keys, or authentication secrets exposed in response",
			CWE:        "CWE-384",
		})
	}

	// API3:2023 Broken Object Property Level Authorization
	if ruleID == "swazz/sensitive-data-leak" || ruleID == "swazz/stack-trace-leak" || ruleID == "swazz/null-pointer-exception" {
		matches = append(matches, ClassificationMatch{
			Category:   "API3:2023 Broken Object Property Level Authorization",
			Standard:   "OWASP_API_2023",
			Weight:     0.95,
			Confidence: "CERTAIN",
			Reason:     "Excessive data exposure: internal properties, PII, or stack trace returned to client",
			CWE:        "CWE-213",
		})
	} else if ruleID == "swazz/server-header-leak" || ruleID == "swazz/x-powered-by-leak" || ruleID == "swazz/x-aspnet-version-leak" {
		matches = append(matches, ClassificationMatch{
			Category:   "API3:2023 Broken Object Property Level Authorization",
			Standard:   "OWASP_API_2023",
			Weight:     0.7,
			Confidence: "MEDIUM",
			Reason:     "Internal infrastructure version details disclosed in HTTP headers",
			CWE:        "CWE-200",
		})
	}

	// API4:2023 Unrestricted Resource Consumption
	if ruleID == "swazz/no-rate-limit" || ruleID == "swazz/rate-limit-active" {
		if !isSensitiveAuthOrBusinessFlow(path) {
			matches = append(matches, ClassificationMatch{
				Category:   "API4:2023 Unrestricted Resource Consumption",
				Standard:   "OWASP_API_2023",
				Weight:     0.95,
				Confidence: "HIGH",
				Reason:     "No rate limiting or request throttling detected on resource-intensive endpoint",
				CWE:        "CWE-770",
			})
		} else {
			matches = append(matches, ClassificationMatch{
				Category:   "API4:2023 Unrestricted Resource Consumption",
				Standard:   "OWASP_API_2023",
				Weight:     0.65,
				Confidence: "MEDIUM",
				Reason:     "Rate limiting absent on business flow endpoint",
				CWE:        "CWE-770",
			})
		}
	} else if ruleID == "swazz/timeout" || ruleID == "swazz/response-size-anomaly" || ruleID == "swazz/ws-timeout" {
		matches = append(matches, ClassificationMatch{
			Category:   "API4:2023 Unrestricted Resource Consumption",
			Standard:   "OWASP_API_2023",
			Weight:     0.85,
			Confidence: "HIGH",
			Reason:     "Payload induced excessive CPU/memory consumption leading to timeout or size anomaly",
			CWE:        "CWE-400",
		})
	}

	// API5:2023 Broken Function Level Authorization (BFLA)
	if (ruleID == "swazz/tenant-isolation-bypass" || ruleID == "swazz/unauthorized-access") && isAdminOrPrivilegedPath(path) {
		matches = append(matches, ClassificationMatch{
			Category:   "API5:2023 Broken Function Level Authorization",
			Standard:   "OWASP_API_2023",
			Weight:     0.98,
			Confidence: "CERTAIN",
			Reason:     "Privileged administrative function accessed without requisite role privileges",
			CWE:        "CWE-285",
		})
	} else if (ctx.Method == "DELETE" || ctx.Method == "PUT" || ctx.Method == "PATCH") && ruleID == "swazz/unauthorized-access" {
		matches = append(matches, ClassificationMatch{
			Category:   "API5:2023 Broken Function Level Authorization",
			Standard:   "OWASP_API_2023",
			Weight:     0.8,
			Confidence: "HIGH",
			Reason:     "State-modifying function accessed without strict authorization checks",
			CWE:        "CWE-285",
		})
	}

	// API6:2023 Unrestricted Access to Sensitive Business Flows
	if isSensitiveAuthOrBusinessFlow(path) && (ruleID == "swazz/no-rate-limit" || ruleID == "swazz/response-size-anomaly") {
		matches = append(matches, ClassificationMatch{
			Category:   "API6:2023 Unrestricted Access to Sensitive Business Flows",
			Standard:   "OWASP_API_2023",
			Weight:     0.96,
			Confidence: "CERTAIN",
			Reason:     "Critical business flow lacks rate limiting, enabling automated abuse / credential stuffing",
			CWE:        "CWE-799",
		})
	}

	// API7:2023 Server Side Request Forgery (SSRF)
	if ruleID == "swazz/oob-interaction" || ruleID == "swazz/ssrf-out-of-band" {
		matches = append(matches, ClassificationMatch{
			Category:   "API7:2023 Server Side Request Forgery",
			Standard:   "OWASP_API_2023",
			Weight:     1.0,
			Confidence: "CERTAIN",
			Reason:     "Out-of-band interaction confirmed target server initiated external DNS/HTTP connection",
			CWE:        "CWE-918",
		})
	}

	// API8:2023 Security Misconfiguration
	if ruleID == "swazz/cors-misconfig" || strings.HasPrefix(ruleID, "swazz/csp-") ||
		strings.HasPrefix(ruleID, "swazz/hsts-") || strings.HasPrefix(ruleID, "swazz/x-frame-") ||
		strings.HasPrefix(ruleID, "swazz/x-content-type-") || ruleID == "swazz/crlf-injection" ||
		ruleID == "swazz/header-injection" {
		matches = append(matches, ClassificationMatch{
			Category:   "API8:2023 Security Misconfiguration",
			Standard:   "OWASP_API_2023",
			Weight:     0.95,
			Confidence: "HIGH",
			Reason:     "Insecure security headers, overly permissive CORS, or HTTP header injection",
			CWE:        "CWE-16",
		})
	}

	// API9:2023 Improper Assets Management
	if ruleID == "swazz/deprecated-api-leak" || (isDeprecatedOrAssetPath(path) && (ruleID == "swazz/unauthorized-access" || strings.HasPrefix(ruleID, "swazz/status-2"))) {
		matches = append(matches, ClassificationMatch{
			Category:   "API9:2023 Improper Assets Management",
			Standard:   "OWASP_API_2023",
			Weight:     0.9,
			Confidence: "HIGH",
			Reason:     "Exposed legacy/debug API version or undocumented management endpoint",
			CWE:        "CWE-1059",
		})
	}

	// API10:2023 Unsafe Consumption of APIs
	if ruleID == "swazz/sql-error-leak" || ruleID == "swazz/time-based-sqli" {
		matches = append(matches, ClassificationMatch{
			Category:   "API10:2023 Unsafe Consumption of APIs",
			Standard:   "OWASP_API_2023",
			Weight:     1.0,
			Confidence: "CERTAIN",
			Reason:     "Downstream SQL injection confirmed via error reflection or time-based blind delay",
			CWE:        "CWE-89",
		})
	} else if ruleID == "swazz/cmdi-leak" || ruleID == "swazz/time-based-cmdi" || ruleID == "swazz/rce-leak" {
		matches = append(matches, ClassificationMatch{
			Category:   "API10:2023 Unsafe Consumption of APIs",
			Standard:   "OWASP_API_2023",
			Weight:     1.0,
			Confidence: "CERTAIN",
			Reason:     "Operating system command injection confirmed via payload execution or time delay",
			CWE:        "CWE-78",
		})
	} else if ruleID == "swazz/reflected-xss" {
		matches = append(matches, ClassificationMatch{
			Category:   "API10:2023 Unsafe Consumption of APIs",
			Standard:   "OWASP_API_2023",
			Weight:     0.95,
			Confidence: "CERTAIN",
			Reason:     "Unsanitized input reflected in response without encoding",
			CWE:        "CWE-79",
		})
	} else if ruleID == "swazz/ssti-leak" {
		matches = append(matches, ClassificationMatch{
			Category:   "API10:2023 Unsafe Consumption of APIs",
			Standard:   "OWASP_API_2023",
			Weight:     1.0,
			Confidence: "CERTAIN",
			Reason:     "Server-Side Template Injection expression evaluated in backend",
			CWE:        "CWE-1336",
		})
	} else if ruleID == "swazz/xxe-leak" {
		matches = append(matches, ClassificationMatch{
			Category:   "API10:2023 Unsafe Consumption of APIs",
			Standard:   "OWASP_API_2023",
			Weight:     1.0,
			Confidence: "CERTAIN",
			Reason:     "XML External Entity parsed and processed by backend parser",
			CWE:        "CWE-611",
		})
	} else if strings.HasPrefix(ruleID, "swazz/mcp-") || strings.HasPrefix(ruleID, "swazz/ws-") {
		matches = append(matches, ClassificationMatch{
			Category:   "API10:2023 Unsafe Consumption of APIs",
			Standard:   "OWASP_API_2023",
			Weight:     0.9,
			Confidence: "HIGH",
			Reason:     "Third-party MCP tool or WebSocket channel crashed or reflected unsanitized input",
			CWE:        "CWE-20",
		})
	} else if strings.HasPrefix(ruleID, "swazz/status-5") || ruleID == "swazz/network-error" {
		matches = append(matches, ClassificationMatch{
			Category:   "API10:2023 Unsafe Consumption of APIs",
			Standard:   "OWASP_API_2023",
			Weight:     0.75,
			Confidence: "MEDIUM",
			Reason:     "Unhandled server exception (5xx) caused by unexpected API input",
			CWE:        "CWE-755",
		})
	}

	// Sort matches by weight descending
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].Weight > matches[j].Weight
	})

	return matches
}

// OWASPAPICategories returns the list of OWASP API Top 10 (2023) categories sorted by relevance.
func OWASPAPICategories(ruleID, method, endpoint, evidence string) []string {
	ctx := &ClassificationContext{
		RuleID:   ruleID,
		Method:   method,
		Endpoint: endpoint,
		Evidence: evidence,
	}
	matches := EvaluateOWASPAPI(ctx)
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]bool)
	var categories []string
	for _, m := range matches {
		if !seen[m.Category] && m.Weight >= 0.5 {
			seen[m.Category] = true
			categories = append(categories, m.Category)
		}
	}
	return categories
}

// CWEIdentifiers extracts the list of unique CWE IDs for a finding context.
func CWEIdentifiers(ruleID, method, endpoint, evidence string) []string {
	ctx := &ClassificationContext{
		RuleID:   ruleID,
		Method:   method,
		Endpoint: endpoint,
		Evidence: evidence,
	}
	matches := EvaluateOWASPAPI(ctx)
	if len(matches) == 0 {
		return nil
	}

	seen := make(map[string]bool)
	var cwes []string
	for _, m := range matches {
		if m.CWE != "" && !seen[m.CWE] && m.Weight >= 0.5 {
			seen[m.CWE] = true
			cwes = append(cwes, m.CWE)
		}
	}
	return cwes
}
