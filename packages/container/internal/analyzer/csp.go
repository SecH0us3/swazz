package analyzer

import (
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
)

// CSPAnalyzer detects missing or weak Content Security Policy headers.
type CSPAnalyzer struct{}

// Analyze parses Content-Security-Policy headers and checks for missing or insecure directives.
func (a *CSPAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	var findings []swagger.AnalysisFinding

	csp := input.ResponseHeaders.Get("Content-Security-Policy")
	cspReportOnly := input.ResponseHeaders.Get("Content-Security-Policy-Report-Only")

	contentType := strings.ToLower(input.ResponseHeaders.Get("Content-Type"))
	isHTML := strings.Contains(contentType, "text/html")

	// 1. Missing CSP on HTML responses
	if isHTML && csp == "" && cspReportOnly == "" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/csp-missing",
			Level:         "warning",
			Message:       "Content Security Policy (CSP) header is missing on HTML response.",
			Evidence:      fmt.Sprintf("Content-Type: %s", input.ResponseHeaders.Get("Content-Type")),
			OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
		})
	}

	// Helper function to check directives in a CSP header
	analyzeHeader := func(headerName, headerVal string) {
		if headerVal == "" {
			return
		}
		// Directives are separated by semicolons
		directives := strings.Split(headerVal, ";")
		for _, d := range directives {
			d = strings.TrimSpace(d)
			if d == "" {
				continue
			}
			parts := strings.Fields(d)
			if len(parts) < 2 {
				continue
			}
			directiveName := parts[0]
			sources := parts[1:]

			for _, src := range sources {
				srcLower := strings.ToLower(src)
				if src == "*" {
					findings = append(findings, swagger.AnalysisFinding{
						RuleID:        "swazz/csp-unsafe-directive",
						Level:         "error",
						Message:       fmt.Sprintf("Overly permissive wildcard '*' source found in %s directive '%s'.", headerName, directiveName),
						Evidence:      fmt.Sprintf("%s: %s", headerName, d),
						OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
					})
				} else if srcLower == "'unsafe-inline'" {
					findings = append(findings, swagger.AnalysisFinding{
						RuleID:        "swazz/csp-unsafe-directive",
						Level:         "error",
						Message:       fmt.Sprintf("Insecure source ''unsafe-inline'' found in %s directive '%s'.", headerName, directiveName),
						Evidence:      fmt.Sprintf("%s: %s", headerName, d),
						OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
					})
				} else if srcLower == "'unsafe-eval'" {
					findings = append(findings, swagger.AnalysisFinding{
						RuleID:        "swazz/csp-unsafe-directive",
						Level:         "error",
						Message:       fmt.Sprintf("Insecure source ''unsafe-eval'' found in %s directive '%s'.", headerName, directiveName),
						Evidence:      fmt.Sprintf("%s: %s", headerName, d),
						OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
					})
				}
			}
		}
	}

	// 2. Analyze directives
	analyzeHeader("Content-Security-Policy", csp)
	analyzeHeader("Content-Security-Policy-Report-Only", cspReportOnly)

	return findings
}
