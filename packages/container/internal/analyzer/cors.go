package analyzer

import (
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
)

// CORSAnalyzer detects CORS misconfiguration by checking if the
// Access-Control-Allow-Origin response header reflects an attacker-controlled
// origin that was sent as part of the security header fuzzing.
type CORSAnalyzer struct{}

// suspiciousCORSOrigins are attacker-controlled origins that should never
// be reflected in Access-Control-Allow-Origin.
var suspiciousCORSOrigins = []string{
	"evil.com",
	"attacker.com",
	"target.com.evil.com",
	"evil.com.target.com",
}

func (a *CORSAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input == nil || input.Profile != swagger.ProfileMalicious {
		return nil
	}
	if input.ResponseHeaders == nil {
		return nil
	}

	acao := input.ResponseHeaders.Get("Access-Control-Allow-Origin")
	if acao == "" {
		return nil
	}

	var findings []swagger.AnalysisFinding

	// Check 1: Wildcard ACAO
	if acao == "*" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/cors-misconfig",
			Level:    "warning",
			Message:  "CORS wildcard: Access-Control-Allow-Origin is set to '*', which allows any origin to access the resource",
			Evidence: fmt.Sprintf("Access-Control-Allow-Origin: %s", acao),
		})
		return findings
	}

	// Check 2: Reflected attacker-controlled origin
	acaoLower := strings.ToLower(acao)
	for _, origin := range suspiciousCORSOrigins {
		if strings.Contains(acaoLower, origin) {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/cors-misconfig",
				Level:    "warning",
				Message:  fmt.Sprintf("CORS origin reflection: server reflected suspicious origin '%s' in Access-Control-Allow-Origin", acao),
				Evidence: fmt.Sprintf("Access-Control-Allow-Origin: %s", acao),
			})
			return findings
		}
	}

	// Check 3: "null" origin (can be exploited via sandboxed iframe)
	if acaoLower == "null" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/cors-misconfig",
			Level:    "warning",
			Message:  "CORS null origin: Access-Control-Allow-Origin is set to 'null', exploitable via sandboxed iframe",
			Evidence: fmt.Sprintf("Access-Control-Allow-Origin: %s", acao),
		})
	}

	return findings
}
