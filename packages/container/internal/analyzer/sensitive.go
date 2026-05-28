package analyzer

import (
	"fmt"
	"regexp"
	"swazz-engine/internal/swagger"
)

type SensitiveAnalyzer struct{}

type secretSignature struct {
	category string
	pattern  *regexp.Regexp
}

var secretSignatures []secretSignature

func init() {
	signatures := []struct {
		category string
		pattern  string
	}{
		{"AWS Access Key", `\b(AKIA[0-9A-Z]{16})\b`},
		{"Private Key Block", `-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----`},
		{"JWT Token", `\b(eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+)\b`},
		{"Internal IP", `\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b`},
		{"Generic Secret/Key", `(?i)(api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9-_]{20,})["']?`},
	}

	for _, sig := range signatures {
		secretSignatures = append(secretSignatures, secretSignature{
			category: sig.category,
			pattern:  regexp.MustCompile(sig.pattern),
		})
	}
}

func (a *SensitiveAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range secretSignatures {
		loc := sig.pattern.FindIndex(input.ResponseBody)
		if loc != nil {
			matchText := string(input.ResponseBody[loc[0]:loc[1]])

			// Redact matched sensitive strings for security before logging
			redactedMatch := matchText
			if len(matchText) > 8 {
				redactedMatch = matchText[:4] + "..." + matchText[len(matchText)-4:]
			}

			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/sensitive-data-leak",
				Level:    "warning",
				Message:  fmt.Sprintf("Sensitive data/secret (%s) leaked in the response body.", sig.category),
				Evidence: fmt.Sprintf("Leaked credential indicator: %s", redactedMatch),
			})
			break
		}
	}

	return findings
}
