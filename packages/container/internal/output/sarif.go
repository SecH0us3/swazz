package output

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"time"

	"swazz-engine/internal/classifier"
)

// ToSARIF generates a SARIF 2.1.0 report.
func ToSARIF(findings []*classifier.Finding, toolVersion string) map[string]any {
	if toolVersion == "" {
		toolVersion = "1.0.0"
	}

	// Collect unique rules and, for Task 64, track which profiles each rule fires on.
	rulesMap := make(map[string]map[string]any)
	ruleProfiles := make(map[string]map[string]bool) // ruleID → set of profile strings
	for _, f := range findings {
		if _, ok := rulesMap[f.RuleID]; !ok {
			rulesMap[f.RuleID] = map[string]any{
				"id":                   f.RuleID,
				"shortDescription":     map[string]string{"text": descriptionForRule(f.RuleID)},
				"defaultConfiguration": map[string]string{"level": string(f.Level)},
			}
			ruleProfiles[f.RuleID] = make(map[string]bool)
		}
		if p := string(f.Profile); p != "" {
			ruleProfiles[f.RuleID][p] = true
		}
	}

	// Task 64: embed profile tags into each rule's properties so CI/CD consumers
	// (GitHub Code Scanning, Azure Boards) can filter findings by fuzzing profile.
	// Sort rule IDs and tags alphabetically for deterministic, reproducible output.
	ruleIDs := make([]string, 0, len(rulesMap))
	for id := range rulesMap {
		ruleIDs = append(ruleIDs, id)
	}
	sort.Strings(ruleIDs)

	rules := make([]map[string]any, 0, len(rulesMap))
	for _, id := range ruleIDs {
		r := rulesMap[id]
		tags := make([]string, 0, len(ruleProfiles[id]))
		for p := range ruleProfiles[id] {
			tags = append(tags, p)
		}
		sort.Strings(tags)
		if len(tags) > 0 {
			r["properties"] = map[string]any{"tags": tags}
		}
		rules = append(rules, r)
	}

	results := make([]map[string]any, 0, len(findings))
	for _, f := range findings {
		props := map[string]any{
			"profile":      string(f.Profile),
			"status":       f.Status,
			"duration":     f.Duration,
			"resolvedPath": f.ResolvedPath,
			"payload":      f.Payload,
			"timestamp":    time.UnixMilli(f.Timestamp).UTC().Format(time.RFC3339),
		}
		if f.ResponseBody != nil {
			props["responseBody"] = f.ResponseBody
		}
		if f.Error != "" {
			props["error"] = f.Error
		}

		statusStr := "TIMEOUT"
		if f.Status != 0 {
			statusStr = strconv.Itoa(f.Status)
		}

		msg := fmt.Sprintf("%s on %s %s with %s profile", statusStr, f.Method, f.Endpoint, f.Profile)
		if f.Error != "" {
			msg += fmt.Sprintf(" (%s)", f.Error)
		}

		// Task 66: physicalLocation.artifactLocation.uri must be a proper URI — only
		// the path, never the HTTP method. Embedding the method caused SARIF viewers
		// (VS Code, GitHub Code Scanning) to apply RFC 3986 host normalisation to the
		// string, which title-cased each path segment (/api/bank → /Api/Bank).
		// The HTTP method is now carried in logicalLocations[0].name instead.
		results = append(results, map[string]any{
			"ruleId":  f.RuleID,
			"level":   string(f.Level),
			"message": map[string]string{"text": msg},
			"locations": []map[string]any{{
				"physicalLocation": map[string]any{
					"artifactLocation": map[string]string{
						"uri": f.Endpoint, // path only — no HTTP method
					},
				},
				"logicalLocations": []map[string]any{{
					"name": f.Method, // HTTP verb lives here (Task 66)
					"kind": "function",
				}},
			}},
			"properties": props,
		})
	}

	return map[string]any{
		"$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
		"version": "2.1.0",
		"runs": []map[string]any{{
			"tool": map[string]any{
				"driver": map[string]any{
					"name":           "swazz",
					"version":        toolVersion,
					"informationUri": "https://github.com/SecH0us3/swazz",
					"rules":          rules,
				},
			},
			"results": results,
		}},
	}
}

var statusCodeRegex = regexp.MustCompile(`swazz/status-(\d+)`)

func descriptionForRule(ruleID string) string {
	if ruleID == "swazz/timeout" {
		return "Request timed out during fuzzing"
	}
	if ruleID == "swazz/network-error" {
		return "Network error during fuzzing"
	}
	matches := statusCodeRegex.FindStringSubmatch(ruleID)
	if len(matches) == 2 {
		code, _ := strconv.Atoi(matches[1])
		if code >= 500 {
			return fmt.Sprintf("Server error %d triggered by fuzz payload", code)
		}
		if code >= 400 {
			return fmt.Sprintf("Client error %d triggered by fuzz payload", code)
		}
		if code >= 200 && code < 300 {
			return fmt.Sprintf("Unexpected success %d with fuzz payload", code)
		}
		return fmt.Sprintf("Unexpected status %d from fuzz payload", code)
	}
	return "Unexpected behavior detected by fuzzing"
}
