// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"fmt"

	"swazz-engine/internal/swagger"
)

// DPoPTamperingAnalyzer detects RFC 9449 DPoP (Demonstrating Proof-of-Possession) proof verification failures and exception leaks.
type DPoPTamperingAnalyzer struct{}

func (a *DPoPTamperingAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Fast pre-filter: skip scanning if no DPoP indicators are present in response body
	if !containsAnyFoldASCII(input.ResponseBody, "dpop", "invalid_dpop_proof", "htm claim", "htu claim", "dpopproof") {
		return nil
	}

	var findings []swagger.AnalysisFinding

	patterns := []string{
		"DPoPProofError",
		"invalid_dpop_proof",
		"dpop proof invalid",
		"dpop token expired",
		"htm claim mismatch",
		"htu claim mismatch",
		"dpop nonce mismatch",
		"dpop signature verification failed",
	}

	for _, p := range patterns {
		if idx := indexFoldASCII(input.ResponseBody, p); idx != -1 {
			matchText := string(input.ResponseBody[idx : idx+len(p)])
			start := idx - 50
			if start < 0 {
				start = 0
			}
			end := idx + len(p) + 50
			if end > len(input.ResponseBody) {
				end = len(input.ResponseBody)
			}
			contextSnippet := string(input.ResponseBody[start:end])
			if len(contextSnippet) > 200 {
				contextSnippet = contextSnippet[:200]
			}

			findings = append(findings, swagger.AnalysisFinding{
				RuleID:           "swazz/dpop-tampering",
				Level:            "warning",
				Message:          "RFC 9449 DPoP proof cryptographic verification error leaked in the response body.",
				Evidence:         fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
				OWASPAPICategory: []string{"API2:2023 Broken Authentication"},
				OWASPCategory:    []string{"A07:2025 Identification and Authentication Failures"},
				CWEIDs:           []string{"CWE-347", "CWE-287"},
			})
			break // Only report the first match to avoid duplicates for a single response
		}
	}

	return findings
}
