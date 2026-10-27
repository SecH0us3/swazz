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

// MassAssignmentAnalyzer detects unauthorized privilege escalation and attribute injection via mass assignment / parameter tampering.
type MassAssignmentAnalyzer struct{}

var (
	massAssignmentRx = regexp.MustCompile(`(?i)"(?:role|role_id|is_admin|admin|tier|permissions|verified|status)"\s*:\s*("admin"|"superadmin"|"active"|true|1|\["[^"]*\*[^"]*"\])`)
	massAssignmentAt = anchoredRegexp(massAssignmentRx.String())
	ormErrorRx       = regexp.MustCompile(`(?i)(ActiveRecord::UnknownAttributeError|UnrecognizedPropertyException|Cannot set property '(?:role|role_id|is_admin|admin|tier|status)' on|MongoError: Unknown modifier: \$set\.(?:role|role_id|is_admin|status))`)
)

// ormErrorLiterals are lowercase substrings of which one appears, ASCII case-insensitively, in
// every ormErrorRx match: one per alternative.
var ormErrorLiterals = []string{
	"activerecord::unknownattributeerror",
	"unrecognizedpropertyexception",
	"cannot set property '",
	"mongoerror: unknown modifier: $set.",
}

// findORMError returns the location of the first ormErrorRx match in the response body, skipping
// the regex when no match can exist.
func findORMError(input *AnalysisInput) []int {
	if !input.containsAnyLower(ormErrorLiterals...) {
		return nil
	}
	return ormErrorRx.FindIndex(input.ResponseBody)
}

// massAssignmentKeys are the attribute names massAssignmentRx matches, each followed by the
// closing quote.
var massAssignmentKeys = []string{`role"`, `role_id"`, `is_admin"`, `admin"`, `tier"`, `permissions"`, `verified"`, `status"`}

// findMassAssignment returns the location of the first massAssignmentRx match in the response
// body. A match opens with a quote and one of massAssignmentKeys, so only those positions are tried.
func findMassAssignment(input *AnalysisInput) []int {
	lower := input.lowerBody()
	return findFrom(input.ResponseBody, massAssignmentAt, '"', func(i int) bool {
		rest := lower[i+1:]
		for _, k := range massAssignmentKeys {
			if strings.HasPrefix(rest, k) {
				return true
			}
		}
		return false
	})
}

func (a *MassAssignmentAnalyzer) hasPrivilegedPayload(input *AnalysisInput) bool {
	if input.SentPayload == nil {
		return false
	}
	payloadStr := input.payloadText()
	return strings.Contains(payloadStr, "role") ||
		strings.Contains(payloadStr, "is_admin") ||
		strings.Contains(payloadStr, "admin") ||
		strings.Contains(payloadStr, "superadmin") ||
		strings.Contains(payloadStr, "permissions") ||
		strings.Contains(payloadStr, "verified") ||
		strings.Contains(payloadStr, "tier") ||
		strings.Contains(payloadStr, "status")
}

func (a *MassAssignmentAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	// Fast pre-filter: skip scanning if no privilege or ORM indicator is present in response body
	if !input.containsAnyLower("role", "role_id", "is_admin", "admin", "superadmin", "permissions", "tier", "verified", "status", "unknownattributeerror", "unrecognizedpropertyexception") {
		return nil
	}

	var findings []swagger.AnalysisFinding

	// 1. Check for ORM / Schema reflection errors
	if loc := findORMError(input); loc != nil {
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
			RuleID:           "swazz/mass-assignment",
			Level:            "warning",
			Message:          "ORM auto-binding attribute error leaked in response body.",
			Evidence:         fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
			OWASPAPICategory: []string{"API3:2023 Broken Object Property Level Authorization"},
			OWASPCategory:    []string{"A01:2025 Broken Access Control"},
			CWEIDs:           []string{"CWE-915"},
		})
		return findings
	}

	// 2. Check for acceptance and reflection of administrative attributes when injected
	if a.hasPrivilegedPayload(input) {
		if loc := findMassAssignment(input); loc != nil {
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
				RuleID:           "swazz/mass-assignment",
				Level:            "error",
				Message:          "Privileged administrative attribute was accepted and reflected in the resource response, indicating Mass Assignment vulnerability.",
				Evidence:         fmt.Sprintf("Match: %q | Context: ...%s...", matchText, contextSnippet),
				OWASPAPICategory: []string{"API3:2023 Broken Object Property Level Authorization"},
				OWASPCategory:    []string{"A01:2025 Broken Access Control"},
				CWEIDs:           []string{"CWE-915"},
			})
		}
	}

	return findings
}
