package analyzer

import (
	"fmt"
	"regexp"
	"strings"
	"swazz-engine/internal/swagger"
)

// SecurityHeadersAnalyzer detects missing or insecure security headers and verbose info disclosures.
type SecurityHeadersAnalyzer struct{}

var versionRegex = regexp.MustCompile(`/\d+`)

// Analyze inspects response headers for security issues.
func (a *SecurityHeadersAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input == nil || input.ResponseHeaders == nil {
		return nil
	}

	var findings []swagger.AnalysisFinding

	// 1. HTTP Strict Transport Security (HSTS)
	hsts := input.ResponseHeaders.Get("Strict-Transport-Security")
	if hsts == "" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/hsts-missing",
			Level:         "warning",
			Message:       "Strict-Transport-Security (HSTS) header is missing, exposing users to SSL stripping attacks.",
			Evidence:      "No Strict-Transport-Security header found in response",
			OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
		})
	} else if !strings.Contains(strings.ToLower(hsts), "max-age") {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/hsts-insecure",
			Level:         "warning",
			Message:       "Strict-Transport-Security (HSTS) header is missing the 'max-age' directive.",
			Evidence:      fmt.Sprintf("Strict-Transport-Security: %s", hsts),
			OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
		})
	}

	// 2. Clickjacking (X-Frame-Options)
	contentType := strings.ToLower(input.ResponseHeaders.Get("Content-Type"))
	isHTML := strings.Contains(contentType, "text/html") || strings.Contains(contentType, "application/xhtml+xml")

	if isHTML {
		xfo := strings.ToUpper(input.ResponseHeaders.Get("X-Frame-Options"))
		if xfo == "" {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:        "swazz/x-frame-options-missing",
				Level:         "warning",
				Message:       "X-Frame-Options header is missing, which could allow Clickjacking attacks.",
				Evidence:      "No X-Frame-Options header found in HTML response",
				OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
			})
		} else if xfo != "DENY" && xfo != "SAMEORIGIN" && !strings.HasPrefix(xfo, "ALLOW-FROM") {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:        "swazz/x-frame-options-insecure",
				Level:         "warning",
				Message:       "X-Frame-Options header is set to an insecure value (must be DENY, SAMEORIGIN, or ALLOW-FROM).",
				Evidence:      fmt.Sprintf("X-Frame-Options: %s", xfo),
				OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
			})
		}
	}

	// 3. MIME Sniffing (X-Content-Type-Options)
	xcto := strings.ToLower(input.ResponseHeaders.Get("X-Content-Type-Options"))
	if xcto == "" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/x-content-type-options-missing",
			Level:         "warning",
			Message:       "X-Content-Type-Options header is missing, exposing client to MIME-sniffing vulnerabilities.",
			Evidence:      "No X-Content-Type-Options header found in response",
			OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
		})
	} else if xcto != "nosniff" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/x-content-type-options-insecure",
			Level:         "warning",
			Message:       "X-Content-Type-Options header is not set to 'nosniff'.",
			Evidence:      fmt.Sprintf("X-Content-Type-Options: %s", xcto),
			OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
		})
	}

	// 4. Server header information leakage
	serverHeader := input.ResponseHeaders.Get("Server")
	if serverHeader != "" && versionRegex.MatchString(serverHeader) {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/server-header-leak",
			Level:         "warning",
			Message:       "Server header leaks software version information, aiding attackers in target profiling.",
			Evidence:      fmt.Sprintf("Server: %s", serverHeader),
			OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
		})
	}

	// 5. X-Powered-By leakage
	xpb := input.ResponseHeaders.Get("X-Powered-By")
	if xpb != "" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/x-powered-by-leak",
			Level:         "warning",
			Message:       "X-Powered-By header leaks implementation technology details.",
			Evidence:      fmt.Sprintf("X-Powered-By: %s", xpb),
			OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
		})
	}

	// 6. X-AspNet-Version leakage
	xav := input.ResponseHeaders.Get("X-AspNet-Version")
	if xav != "" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/x-aspnet-version-leak",
			Level:         "warning",
			Message:       "X-AspNet-Version header leaks ASP.NET framework version details.",
			Evidence:      fmt.Sprintf("X-AspNet-Version: %s", xav),
			OWASPCategory: []string{"A02:2025 Security Misconfiguration"},
		})
	}

	return findings
}
