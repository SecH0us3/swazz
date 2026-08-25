// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
	"fmt"
	"strings"

	"swazz-engine/internal/swagger"
)

const (
	// defaultBOLAThreshold is the minimum body-similarity score required to
	// classify a response as a confirmed BOLA/IDOR or unauthorised-access hit.
	defaultBOLAThreshold = 0.85
)

// isIDParam reports whether a struct-field name looks like an identifier
// parameter (id, uuid, anything ending in "id").
// This predicate used to be repeated 6+ times inline; giving it a name makes
// the intent visible at each call site.
func isIDParam(name string) bool {
	lower := strings.ToLower(name)
	return lower == "id" || lower == "uuid" || strings.HasSuffix(lower, "id")
}

// firstPathParam returns the name of the first {param} segment in a URL
// template, or "" if none exists.
func firstPathParam(templatePath string) string {
	for _, part := range strings.Split(strings.Trim(templatePath, "/"), "/") {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			return part[1 : len(part)-1]
		}
	}
	return ""
}

// bolaThreshold returns the configured BOLA similarity threshold, falling back
// to the package default when the setting is unset or zero.
func bolaThreshold(settings swagger.Settings) float64 {
	if settings.BOLASimilarityThreshold > 0 {
		return settings.BOLASimilarityThreshold
	}
	return defaultBOLAThreshold
}

// formatIdentityName returns a display-friendly identity name.
func formatIdentityName(name string) string {
	if strings.EqualFold(name, "userb") {
		return "User B"
	}
	return name
}

// getPathPrefix returns the static prefix of a URL template up to the first
// path parameter, e.g. "/api/goods/{id}" → "/api/goods".
func getPathPrefix(originalPath string) string {
	idx := strings.IndexByte(originalPath, '{')
	if idx != -1 {
		return strings.TrimRight(originalPath[:idx], "/")
	}
	return originalPath
}

// ArePrefixesRelated reports whether two path prefixes share at least the first
// two segments, used to identify "sibling" endpoints in the same resource group.
func arePrefixesRelated(p1, p2 string) bool {
	p1Trim := strings.Trim(p1, "/")
	p2Trim := strings.Trim(p2, "/")
	if p1Trim == "" || p2Trim == "" {
		return false
	}
	p1Parts := strings.Split(p1Trim, "/")
	p2Parts := strings.Split(p2Trim, "/")

	matchLen := min(2, min(len(p1Parts), len(p2Parts)))
	if matchLen == 0 {
		return false
	}
	for i := range matchLen {
		if p1Parts[i] != p2Parts[i] {
			return false
		}
	}
	return true
}

// mergeUniqueStrings returns the union of two string slices without duplicates.
func mergeUniqueStrings(a, b []string) []string {
	seen := make(map[string]bool, len(a)+len(b))
	for _, s := range a {
		seen[s] = true
	}
	for _, s := range b {
		seen[s] = true
	}
	out := make([]string, 0, len(seen))
	for s := range seen {
		out = append(out, s)
	}
	return out
}

// containsFold reports whether any element of list equals s
// (case-insensitive).
func containsFold(list []string, s string) bool {
	for _, item := range list {
		if strings.EqualFold(item, s) {
			return true
		}
	}
	return false
}

// idSourceFor returns the recorded source endpoint for a harvested ID.
func (d *Detector) idSourceFor(id string) string {
	if id == "" {
		return "Unknown"
	}
	if src, ok := d.idSources.Load(id); ok {
		return src.(string)
	}
	return "Unknown"
}

// buildIDORFinding creates a BOLA/IDOR or tenant-isolation-bypass finding
// depending on whether a concrete resource ID was involved in the probe.
func buildIDORFinding(
	displayName string,
	cand *swagger.FuzzResult,
	resolvedPath string,
	status int,
	targetID, paramName, minedFrom string,
	sim float64,
) swagger.AnalysisFinding {
	if targetID != "" || paramName != "" {
		return swagger.AnalysisFinding{
			RuleID:   "swazz/bola-idor",
			Level:    "error",
			Message:  fmt.Sprintf("BOLA / IDOR vulnerability confirmed. Identity %s succeeded to access resource of Identity A.", displayName),
			Evidence: fmt.Sprintf("Identity: %s, Endpoint: %s %s, Status: %d, ID %s mined from: %s (Similarity: %.2f)", displayName, cand.Method, resolvedPath, status, targetID, minedFrom, sim),
		}
	}
	return swagger.AnalysisFinding{
		RuleID:   "swazz/tenant-isolation-bypass",
		Level:    "warning",
		Message:  fmt.Sprintf("Tenant Isolation Bypass candidate. Identity %s successfully accessed endpoint normally used by Identity A.", displayName),
		Evidence: fmt.Sprintf("Identity: %s, Endpoint: %s %s, Status: %d (Similarity: %.2f)", displayName, cand.Method, resolvedPath, status, sim),
	}
}

// buildUnauthorizedFinding creates an unauthorized-access finding for an
// anonymous probe that returned a suspiciously similar response.
func buildUnauthorizedFinding(
	cand *swagger.FuzzResult,
	resolvedPath string,
	status int,
	targetID, minedFrom string,
	sim float64,
) swagger.AnalysisFinding {
	evidence := fmt.Sprintf("Endpoint: %s %s, Status: %d (Similarity: %.2f)", cand.Method, resolvedPath, status, sim)
	if targetID != "" {
		evidence = fmt.Sprintf("Endpoint: %s %s, Status: %d, ID %s mined from: %s (Similarity: %.2f)", cand.Method, resolvedPath, status, targetID, minedFrom, sim)
	}
	return swagger.AnalysisFinding{
		RuleID:   "swazz/unauthorized-access",
		Level:    "error",
		Message:  "Unauthenticated access bypass vulnerability confirmed. Endpoint accepts requests without authentication credentials.",
		Evidence: evidence,
	}
}
