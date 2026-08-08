// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package triage

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// TriageVerdict represents the structured output of an LLM triage classification.
type TriageVerdict struct {
	Classification string `json:"classification"` // "true_positive" or "false_positive"
	Confidence     int    `json:"confidence"`     // 0 - 100
	Reasoning      string `json:"reasoning"`
}

var markdownCodeBlockRegex = regexp.MustCompile(`(?s)^\s*` + "```" + `(?:json)?\s*(.*?)\s*` + "```" + `\s*$`)

// ParseResponse cleans markdown formatting and unmarshals the LLM's JSON verdict.
func ParseResponse(raw string) (*TriageVerdict, error) {
	cleaned := strings.TrimSpace(raw)
	if cleaned == "" {
		return nil, fmt.Errorf("empty LLM response")
	}

	// Strip markdown code block wrappers if present (e.g. ```json ... ```)
	if matches := markdownCodeBlockRegex.FindStringSubmatch(cleaned); len(matches) > 1 {
		cleaned = strings.TrimSpace(matches[1])
	} else {
		// Fallback: strip inline leading/trailing backticks
		cleaned = strings.TrimPrefix(cleaned, "```json")
		cleaned = strings.TrimPrefix(cleaned, "```")
		cleaned = strings.TrimSuffix(cleaned, "```")
		cleaned = strings.TrimSpace(cleaned)
	}

	var verdict TriageVerdict
	if err := json.Unmarshal([]byte(cleaned), &verdict); err != nil {
		return nil, fmt.Errorf("failed to parse triage JSON: %w (raw response: %s)", err, raw)
	}

	// Normalize classification string
	classLower := strings.ToLower(strings.TrimSpace(verdict.Classification))
	if classLower == "true_positive" || classLower == "tp" || classLower == "true positive" {
		verdict.Classification = "true_positive"
	} else if classLower == "false_positive" || classLower == "fp" || classLower == "false positive" {
		verdict.Classification = "false_positive"
	} else {
		return nil, fmt.Errorf("invalid classification value '%s'", verdict.Classification)
	}

	// Clamp confidence to 0-100
	if verdict.Confidence < 0 {
		verdict.Confidence = 0
	} else if verdict.Confidence > 100 {
		verdict.Confidence = 100
	}

	return &verdict, nil
}
