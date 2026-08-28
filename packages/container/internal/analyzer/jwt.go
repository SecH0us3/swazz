// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"fmt"
	"regexp"
	"strings"

	"swazz-engine/internal/swagger"
)

// JWTTamperingAnalyzer detects JWT signature verification bypasses, alg:none acceptance, and internal JWT verification exception leaks.
type JWTTamperingAnalyzer struct{}

var (
	jwtErrorRx = regexp.MustCompile(`(?i)(JsonWebTokenError|TokenExpiredError|jwt\.exceptions\.\w+|ExpiredSignatureError|invalid algorithm:\s*none|KeyFunc returned error|crypto/rsa:\s*verification error|JWKNotFoundException|nimbus-jose-jwt|jose\.exceptions)`)
	jwtAlgNone = "eyJhbGciOiJub25l"
)

func (a *JWTTamperingAnalyzer) isAlgNonePayload(input *AnalysisInput) bool {
	if input.SentPayload != nil && strings.Contains(fmt.Sprintf("%v", input.SentPayload), jwtAlgNone) {
		return true
	}
	return false
}

func (a *JWTTamperingAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Fast pre-filter: skip scanning if no JWT error indicators or alg:none payloads are present
	if !containsAnyFoldASCII(input.ResponseBody, "jwt", "jsonwebtoken", "tokenexpirederror", "expiredsignatureerror", "algorithm: none", "keyfunc", "rsa: verification", "jwk", "nimbus", "jose") && !a.isAlgNonePayload(input) {
		return nil
	}

	var findings []swagger.AnalysisFinding

	// 1. Check for JWT library exceptions and signature verification trace leaks
	if loc := jwtErrorRx.FindIndex(input.ResponseBody); loc != nil {
		matchText := string(input.ResponseBody[loc[0]:loc[1]])
		start := loc[0] - 50
		if start < 0 {
			start = 0
		}
		end := loc[1] + 50
		if end > len(input.ResponseBody) {
			end = len(input.ResponseBody)
		}
		contextSnippet := string(input.ResponseBody[start:end])
		if len(contextSnippet) > 200 {
			contextSnippet = contextSnippet[:200]
		}

		findings = append(findings, swagger.AnalysisFinding{
			RuleID:           "swazz/jwt-tampering",
			Level:            "error",
			Message:          "JWT cryptographic verification error leaked in the response body.",
			Evidence:         fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
			OWASPAPICategory: []string{"API2:2023 Broken Authentication"},
			OWASPCategory:    []string{"A07:2025 Identification and Authentication Failures"},
			CWEIDs:           []string{"CWE-347", "CWE-287"},
		})
		return findings
	}

	// 2. Check for acceptance of alg:none token (authenticated data returned when alg:none token sent)
	if a.isAlgNonePayload(input) && containsAnyFoldASCII(input.ResponseBody, "\"user\":", "\"email\":", "\"roles\":", "\"username\":", "\"sub\":") {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:           "swazz/jwt-tampering",
			Level:            "critical",
			Message:          "Server accepted an unsigned or alg:none JWT payload and returned authenticated resource data.",
			Evidence:         string(input.ResponseBody),
			OWASPAPICategory: []string{"API2:2023 Broken Authentication"},
			OWASPCategory:    []string{"A07:2025 Identification and Authentication Failures"},
			CWEIDs:           []string{"CWE-347", "CWE-287"},
		})
	}

	return findings
}
