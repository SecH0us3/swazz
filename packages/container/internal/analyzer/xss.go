package analyzer

import (
	"encoding/json"
	"fmt"
	"strings"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

type XSSAnalyzer struct{}

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

	var findings []swagger.AnalysisFinding
	bodyStr := string(input.ResponseBody)
	contentType := input.ResponseHeaders.Get("Content-Type")

	isHTML := strings.Contains(strings.ToLower(contentType), "text/html")
	isJSON := strings.Contains(contentType, "application/json") || (strings.HasPrefix(strings.TrimSpace(bodyStr), "{") && json.Valid(input.ResponseBody))

	if isJSON && !isHTML {
		// Safe JSON context
		return nil
	}

	for _, payloadStr := range sentStrings {
		if payloadStr == "" {
			continue
		}

		// Verify if the sent payload is one of the malicious XSS payloads
		isXSSPayload := false
		for _, x := range payloads.MaliciousXSS {
			if xStr, ok := x.(string); ok && xStr == payloadStr {
				isXSSPayload = true
				break
			}
		}

		if !isXSSPayload {
			continue
		}

		if strings.Contains(strings.ToLower(bodyStr), strings.ToLower(payloadStr)) {
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
