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

// maliciousXSSSet is a pre-built set for O(1) payload lookups instead of O(N) slice scan.
var maliciousXSSSet map[string]struct{}

func init() {
	maliciousXSSSet = make(map[string]struct{}, len(payloads.MaliciousXSS))
	for _, x := range payloads.MaliciousXSS {
		if s, ok := x.(string); ok {
			maliciousXSSSet[s] = struct{}{}
		}
	}
}

func extractStrings(v any) []string {
	var stringsList []string
	extractStringsHelper(v, &stringsList)
	return stringsList
}

func extractStringsHelper(v any, out *[]string) {
	switch val := v.(type) {
	case string:
		*out = append(*out, val)
	case map[string]any:
		for _, item := range val {
			extractStringsHelper(item, out)
		}
	case []any:
		for _, item := range val {
			extractStringsHelper(item, out)
		}
	}
}

func (a *XSSAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}

	sentStrings := extractStrings(input.SentPayload)
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
	bodyLower := bytes.ToLower(input.ResponseBody)

	for _, payloadStr := range sentStrings {
		if payloadStr == "" {
			continue
		}

		// O(1) lookup in pre-built set instead of O(N) slice scan
		if _, ok := maliciousXSSSet[payloadStr]; !ok {
			continue
		}

		payloadLower := []byte(strings.ToLower(payloadStr))
		if bytes.Contains(bodyLower, payloadLower) {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/reflected-xss",
				Level:    "error",
				Message:  fmt.Sprintf("Reflected XSS payload '%s' detected unescaped in the response body.", payloadStr),
				Evidence: fmt.Sprintf("Found payload: %s", payloadStr),
			})
		}
	}

	return findings
}
