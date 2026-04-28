package output

import (
	"fmt"
	"regexp"
	"strconv"
	"time"

	"swazz-engine/internal/classifier"
)

// ToSARIF generates a SARIF 2.1.0 report.
func ToSARIF(findings []*classifier.Finding, toolVersion string) map[string]any {
	if toolVersion == "" {
		toolVersion = "1.0.0"
	}

	// Collect unique rules
	rulesMap := make(map[string]map[string]any)
	for _, f := range findings {
		if _, ok := rulesMap[f.RuleID]; !ok {
			rulesMap[f.RuleID] = map[string]any{
				"id":                   f.RuleID,
				"shortDescription":     map[string]string{"text": descriptionForRule(f.RuleID)},
				"defaultConfiguration": map[string]string{"level": string(f.Level)},
			}
		}
	}

	rules := make([]map[string]any, 0, len(rulesMap))
	for _, r := range rulesMap {
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

		results = append(results, map[string]any{
			"ruleId":  f.RuleID,
			"level":   string(f.Level),
			"message": map[string]string{"text": msg},
			"locations": []map[string]any{{
				"physicalLocation": map[string]any{
					"artifactLocation": map[string]string{
						"uri": fmt.Sprintf("%s %s", f.Method, f.Endpoint),
					},
				},
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
