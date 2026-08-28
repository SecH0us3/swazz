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

// GraphQLSecurityAnalyzer inspects GraphQL endpoints for introspection leaks, field suggestions, and batching/complexity errors.
type GraphQLSecurityAnalyzer struct{}

var (
	gqlIntrospectionRx   = regexp.MustCompile(`"__schema"\s*:\s*\{[^}]*"queryType"`)
	gqlFieldSuggestionRx = regexp.MustCompile(`(?i)Did you mean\s+\\?["']?([^"'\\\?]+)\\?["']?\?`)
	gqlComplexityRx      = regexp.MustCompile(`(?i)(max\s+query\s+depth\s+exceeded|query\s+complexity\s+limit|too\s+many\s+nested\s+queries)`)
)

func (a *GraphQLSecurityAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Fast pre-filter: skip scanning if no GraphQL keywords are present
	if !containsAnyFoldASCII(input.ResponseBody, "__schema", "did you mean", "query depth", "complexity limit", "nested queries") {
		return nil
	}

	var findings []swagger.AnalysisFinding

	// 1. Introspection Schema Leak
	if loc := gqlIntrospectionRx.FindIndex(input.ResponseBody); loc != nil {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:           "swazz/graphql-introspection-leak",
			Level:            "warning",
			Message:          "GraphQL schema introspection is enabled in production, exposing full schema definitions.",
			Evidence:         string(input.ResponseBody[:min(len(input.ResponseBody), 300)]),
			OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
			OWASPCategory:    []string{"A05:2025 Security Misconfiguration"},
			CWEIDs:           []string{"CWE-200"},
		})
	}

	// 2. Field Suggestion Leak
	if loc := gqlFieldSuggestionRx.FindIndex(input.ResponseBody); loc != nil {
		matchText := string(input.ResponseBody[loc[0]:loc[1]])
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:           "swazz/graphql-field-suggestion",
			Level:            "note",
			Message:          fmt.Sprintf("GraphQL field suggestion leaked internal schema field name: %s", matchText),
			Evidence:         matchText,
			OWASPAPICategory: []string{"API8:2023 Security Misconfiguration"},
			OWASPCategory:    []string{"A05:2025 Security Misconfiguration"},
			CWEIDs:           []string{"CWE-200"},
		})
	}

	// 3. Query Complexity / Batching limit error
	if loc := gqlComplexityRx.FindIndex(input.ResponseBody); loc != nil {
		matchText := string(input.ResponseBody[loc[0]:loc[1]])
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:           "swazz/graphql-complexity-limit",
			Level:            "warning",
			Message:          "GraphQL batching query complexity limit reached during fuzzing.",
			Evidence:         matchText,
			OWASPAPICategory: []string{"API4:2023 Unrestricted Resource Consumption"},
			OWASPCategory:    []string{"A05:2025 Security Misconfiguration"},
			CWEIDs:           []string{"CWE-400"},
		})
	}

	return findings
}
