// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

type XSSAnalyzer struct{}

// maliciousXSSSet maps each XSS payload to its lowercased form, for O(1) lookups instead of an
// O(N) slice scan.
var maliciousXSSSet map[string][]byte

func init() {
	maliciousXSSSet = make(map[string][]byte, len(payloads.MaliciousXSS))
	for _, x := range payloads.MaliciousXSS {
		if s, ok := x.(string); ok {
			maliciousXSSSet[s] = []byte(strings.ToLower(s))
		}
	}
}

func extractStringsInto(out []string, v any) []string {
	switch val := v.(type) {
	case string:
		out = append(out, val)
	case map[string]any:
		for _, item := range val {
			out = extractStringsInto(out, item)
		}
	case []any:
		for _, item := range val {
			out = extractStringsInto(out, item)
		}
	}
	return out
}

func (a *XSSAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}

	sentStrings := input.sentStrings()
	if len(sentStrings) == 0 {
		return nil
	}

	contentType := input.ResponseHeaders.Get("Content-Type")
	contentTypeLower := strings.ToLower(contentType)
	isHTML := strings.Contains(contentTypeLower, "text/html")

	var isJSON bool
	if strings.Contains(contentTypeLower, "application/json") {
		isJSON = true
	} else {
		trimmedBody := bytes.TrimSpace(input.ResponseBody)
		if (bytes.HasPrefix(trimmedBody, []byte("{")) || bytes.HasPrefix(trimmedBody, []byte("["))) && json.Valid(input.ResponseBody) {
			isJSON = true
		}
	}

	if isJSON && !isHTML {
		// Safe JSON context
		return nil
	}

	var findings []swagger.AnalysisFinding
	// Lowercased (Unicode-aware) only once a sent string is a known XSS payload.
	var bodyLower []byte

	for _, payloadStr := range sentStrings {
		if payloadStr == "" {
			continue
		}

		// O(1) lookup in pre-built set instead of O(N) slice scan
		payloadLower, ok := maliciousXSSSet[payloadStr]
		if !ok {
			continue
		}

		if bodyLower == nil {
			bodyLower = bytes.ToLower(input.ResponseBody)
		}
		if bytes.Contains(bodyLower, payloadLower) {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:           "swazz/reflected-xss",
				Level:            "error",
				Message:          fmt.Sprintf("Reflected XSS payload '%s' detected unescaped in the response body.", payloadStr),
				Evidence:         fmt.Sprintf("Found payload: %s", payloadStr),
				OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
				OWASPCategory:    []string{"A05:2025 Injection"},
				CWEIDs:           []string{"CWE-79"},
			})
		}
	}

	return findings
}
