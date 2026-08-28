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

// PrototypePollutionAnalyzer detects Prototype Pollution vulnerabilities and runtime errors in JavaScript/Node.js backends.
type PrototypePollutionAnalyzer struct{}

var (
	protoReflectionRx = regexp.MustCompile(`(?i)"polluted"\s*:\s*("?true"?|"yes"|1|true)`)
	protoErrorRx      = regexp.MustCompile(`(?i)(cannot\s+(?:create|set|assign\s+to\s+read\s+only)\s+property\s+['"]?polluted['"]?|cannot\s+set\s+properties\s+of\s+undefined|object\.prototype\.__proto__|prototype\s+pollution)`)
)

func (a *PrototypePollutionAnalyzer) isProtoPayload(payload any) bool {
	if payload == nil {
		return false
	}
	payloadStr := fmt.Sprintf("%v", payload)
	return strings.Contains(payloadStr, "__proto__") ||
		strings.Contains(payloadStr, "constructor.prototype") ||
		strings.Contains(payloadStr, "prototype.polluted") ||
		strings.Contains(payloadStr, "polluted")
}

func (a *PrototypePollutionAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Fast pre-filter: skip scanning if no prototype pollution indicators are present in response body
	if !containsAnyFoldASCII(input.ResponseBody, "polluted", "prototype", "__proto__", "cannot create property", "cannot set property", "cannot assign") {
		return nil
	}

	var findings []swagger.AnalysisFinding

	// 1. Check for runtime Prototype Pollution exceptions / Node.js crash indicators
	if loc := protoErrorRx.FindIndex(input.ResponseBody); loc != nil {
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
			RuleID:           "swazz/prototype-pollution",
			Level:            "error",
			Message:          "Prototype Pollution runtime error leaked in the response body.",
			Evidence:         fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
			OWASPAPICategory: []string{"API3:2023 Broken Object Property Level Authorization"},
			OWASPCategory:    []string{"A08:2025 Software and Data Integrity Failures"},
			CWEIDs:           []string{"CWE-1321"},
		})
		return findings
	}

	// 2. Check for reflected polluted properties when prototype payloads were sent
	if a.isProtoPayload(input.SentPayload) {
		if loc := protoReflectionRx.FindIndex(input.ResponseBody); loc != nil {
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
				RuleID:           "swazz/prototype-pollution",
				Level:            "error",
				Message:          "Injected prototype property ('polluted') was reflected in the JSON response object, indicating object prototype pollution.",
				Evidence:         fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
				OWASPAPICategory: []string{"API3:2023 Broken Object Property Level Authorization"},
				OWASPCategory:    []string{"A08:2025 Software and Data Integrity Failures"},
				CWEIDs:           []string{"CWE-1321"},
			})
		}
	}

	return findings
}
