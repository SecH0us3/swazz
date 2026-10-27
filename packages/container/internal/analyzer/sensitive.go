// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"fmt"
	"regexp"
	"swazz-engine/internal/swagger"
)

type SensitiveAnalyzer struct{}

const internalIPPattern = `\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b`

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
		{"Internal IP", internalIPPattern},
		{"Generic Secret/Key", `(?i)(api[_-]?key|apikey|secret[_-]?key|access[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9-_]{20,})["']?`},
	}

	for _, sig := range signatures {
		secretSignatures = append(secretSignatures, secretSignature{
			category: sig.category,
			pattern:  regexp.MustCompile(sig.pattern),
		})
	}
}

// internalIPAt is the "Internal IP" signature anchored for findInternalIP.
var internalIPAt = anchoredRegexp(internalIPPattern)

// findInternalIP returns the location of the first internalIPRx match in body. A match opens at a
// word boundary with "10.", "172." or "192.168.", so only those positions are tried; the anchored
// pattern's own leading \b always holds there, so the boundary is checked against the byte before.
func findInternalIP(body []byte) []int {
	return findFrom(body, internalIPAt, '1', func(i int) bool {
		if i > 0 && isWordASCII(body[i-1]) {
			return false
		}
		rest := body[i:]
		return bytes.HasPrefix(rest, []byte("10.")) || bytes.HasPrefix(rest, []byte("172.")) || bytes.HasPrefix(rest, []byte("192.168."))
	})
}

func (a *SensitiveAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Fast pre-filter: skip scanning if no secret/key indicators are present in response body
	if !input.containsAnyLower("akia", "aiza", "xox", "sk_live", "-----begin", "eyj", "10.", "172.", "192.168.", "key", "token", "secret", "apikey", "api_key") {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range secretSignatures {
		switch sig.category {
		case "AWS Access Key":
			if !input.containsLower("akia") {
				continue
			}
		case "Google Cloud API Key":
			if !input.containsLower("aiza") {
				continue
			}
		case "Slack Token":
			if !input.containsLower("xox") {
				continue
			}
		case "Stripe Standard API Key":
			if !input.containsLower("sk_live") {
				continue
			}
		case "Private Key Block":
			if !input.containsLower("-----begin") {
				continue
			}
		case "JWT Token":
			if !input.containsLower("eyj") {
				continue
			}
		case "Internal IP":
			if !input.containsAnyLower("10.", "172.", "192.168.") {
				continue
			}
		case "Generic Secret/Key":
			if !input.containsAnyLower("key", "secret", "token", "apikey") {
				continue
			}
		}

		var loc []int
		if sig.category == "Internal IP" {
			loc = findInternalIP(input.ResponseBody)
		} else {
			loc = sig.pattern.FindIndex(input.ResponseBody)
		}
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
				OWASPCategory:    []string{"A04:2025 Cryptographic Failures"},
				CWEIDs:           []string{"CWE-200", "CWE-312"},
			})
		}
	}

	return findings
}
