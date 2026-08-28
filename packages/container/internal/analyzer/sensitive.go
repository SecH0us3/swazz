// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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
		{"Google Cloud API Key", `\b(AIza[0-9A-Za-z-_]{35})\b`},
		{"Slack Token", `\b(xox[baprs]-[0-9a-zA-Z]{10,})\b`},
		{"Stripe Standard API Key", `\b(sk_live_[0-9a-zA-Z]{24,})\b`},
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

	// Fast pre-filter: skip scanning if no secret/key indicators are present in response body
	if !containsAnyFoldASCII(input.ResponseBody, "akia", "aiza", "xox", "sk_live", "-----begin", "eyj", "10.", "172.", "192.168.", "key", "token", "secret", "apikey", "api_key") {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range secretSignatures {
		switch sig.category {
		case "AWS Access Key":
			if !containsFoldASCII(input.ResponseBody, "akia") {
				continue
			}
		case "Google Cloud API Key":
			if !containsFoldASCII(input.ResponseBody, "aiza") {
				continue
			}
		case "Slack Token":
			if !containsFoldASCII(input.ResponseBody, "xox") {
				continue
			}
		case "Stripe Standard API Key":
			if !containsFoldASCII(input.ResponseBody, "sk_live") {
				continue
			}
		case "Private Key Block":
			if !containsFoldASCII(input.ResponseBody, "-----begin") {
				continue
			}
		case "JWT Token":
			if !containsFoldASCII(input.ResponseBody, "eyj") {
				continue
			}
		case "Internal IP":
			if !containsAnyFoldASCII(input.ResponseBody, "10.", "172.", "192.168.") {
				continue
			}
		case "Generic Secret/Key":
			if !containsAnyFoldASCII(input.ResponseBody, "key", "secret", "token", "apikey") {
				continue
			}
		}

		loc := sig.pattern.FindIndex(input.ResponseBody)
		if loc != nil {
			matchText := string(input.ResponseBody[loc[0]:loc[1]])

			// Redact matched sensitive strings for security before logging
			redactedMatch := matchText
			if len(matchText) > 8 {
				redactedMatch = matchText[:4] + "..." + matchText[len(matchText)-4:]
			}

			findings = append(findings, swagger.AnalysisFinding{
				RuleID:           "swazz/sensitive-data-leak",
				Level:            "warning",
				Message:          fmt.Sprintf("Sensitive data/secret (%s) leaked in the response body.", sig.category),
				Evidence:         fmt.Sprintf("Leaked credential indicator: %s", redactedMatch),
				OWASPAPICategory: []string{"API3:2023 Broken Object Property Level Authorization"},
				OWASPCategory:    []string{"A02:2025 Cryptographic Failures"},
				CWEIDs:           []string{"CWE-200", "CWE-312"},
			})
		}
	}

	return findings
}
