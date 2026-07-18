package output

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"swazz-engine/internal/classifier"
)

// ToSARIF generates a SARIF 2.1.0 report.
func ToSARIF(findings []*classifier.Finding, toolVersion string, baseURL string) map[string]any {
	if toolVersion == "" {
		toolVersion = "1.0.0"
	}

	// Collect unique rules and, for Task 64, track which profiles each rule fires on.
	rulesMap := make(map[string]map[string]any)
	ruleProfiles := make(map[string]map[string]bool) // ruleID → set of profile strings
	for _, f := range findings {
		if _, ok := rulesMap[f.RuleID]; !ok {
			r := map[string]any{
				"id":                   f.RuleID,
				"shortDescription":     map[string]string{"text": descriptionForRule(f.RuleID)},
				"defaultConfiguration": map[string]string{"level": string(f.Level)},
			}
			if cweID := cweForRule(f.RuleID); cweID != "" {
				r["properties"] = map[string]any{"cwe": cweID}
			}
			rulesMap[f.RuleID] = r
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
		
		props, ok := r["properties"].(map[string]any)
		if !ok {
			props = make(map[string]any)
			r["properties"] = props
		}
		if len(tags) > 0 {
			props["tags"] = tags
		}
		if cweID := cweForRule(id); cweID != "" {
			props["cwe"] = cweID
		}
		
		rules = append(rules, r)
	}

	results := make([]map[string]any, 0, len(findings))
	for _, f := range findings {
		statusStr := "TIMEOUT"
		if f.Status != 0 {
			statusStr = strconv.Itoa(f.Status)
		}

		// Reconstruct target full URL
		fullURL := ""
		if strings.HasPrefix(f.ResolvedPath, "http://") || strings.HasPrefix(f.ResolvedPath, "https://") {
			fullURL = f.ResolvedPath
		} else if baseURL != "" {
			if f.ResolvedPath == "" {
				fullURL = baseURL
			} else {
				base := strings.TrimSuffix(baseURL, "/")
				path := strings.TrimPrefix(f.ResolvedPath, "/")
				fullURL = base + "/" + path
			}
		} else {
			fullURL = f.ResolvedPath
		}

		// Construct webRequest and webResponse objects
		webRequest := map[string]any{
			"method": f.Method,
			"url":    fullURL,
			"body":   f.Payload,
		}

		respBodyStr := ""
		if f.ResponseBody != nil {
			switch v := f.ResponseBody.(type) {
			case string:
				respBodyStr = v
			case []byte:
				respBodyStr = string(v)
			default:
				respBodyStr = fmt.Sprintf("%v", v)
			}
		}

		webResponse := map[string]any{
			"statusCode": f.Status,
			"body":       respBodyStr,
		}

		props := map[string]any{
			"profile":      string(f.Profile),
			"status":       f.Status,
			"duration":     f.Duration,
			"resolvedPath": f.ResolvedPath,
			"payload":      f.Payload,
			"timestamp":    time.UnixMilli(f.Timestamp).UTC().Format(time.RFC3339),
			"webRequest":   webRequest,
			"webResponse":  webResponse,
		}
		if f.ResponseBody != nil {
			props["responseBody"] = f.ResponseBody
		}
		if f.Error != "" {
			props["error"] = f.Error
		}

		msg := fmt.Sprintf("%s on %s %s with %s profile", statusStr, f.Method, f.Endpoint, f.Profile)
		if f.Error != "" {
			msg += fmt.Sprintf(" (%s)", f.Error)
		}

		// Construct markdown message overview
		payloadStr := ""
		if f.Payload != nil {
			if s, ok := f.Payload.(string); ok {
				var js any
				if err := json.Unmarshal([]byte(s), &js); err == nil {
					if jsonBytes, err := json.MarshalIndent(js, "", "  "); err == nil {
						payloadStr = string(jsonBytes)
					} else {
						payloadStr = s
					}
				} else {
					payloadStr = s
				}
			} else {
				if jsonBytes, err := json.MarshalIndent(f.Payload, "", "  "); err == nil {
					payloadStr = string(jsonBytes)
				} else {
					payloadStr = fmt.Sprintf("%v", f.Payload)
				}
			}
		}

		// Truncate response body if it's longer than 2000 characters (rune-safe)
		truncatedRespBodyStr := respBodyStr
		if len(truncatedRespBodyStr) > 2000 {
			runes := []rune(truncatedRespBodyStr)
			if len(runes) > 2000 {
				truncatedRespBodyStr = string(runes[:2000]) + "\n... [TRUNCATED]"
			}
		}

		var markdownLines []string
		markdownLines = append(markdownLines, fmt.Sprintf("### Finding: %s", f.RuleID))
		markdownLines = append(markdownLines, "")
		markdownLines = append(markdownLines, fmt.Sprintf("- **Endpoint:** `%s %s`", f.Method, f.Endpoint))
		markdownLines = append(markdownLines, fmt.Sprintf("- **Profile:** `%s`", f.Profile))
		markdownLines = append(markdownLines, fmt.Sprintf("- **Status:** %s", statusStr))
		markdownLines = append(markdownLines, fmt.Sprintf("- **Duration:** %dms", f.Duration))
		if f.Error != "" {
			markdownLines = append(markdownLines, fmt.Sprintf("- **Error:** %s", f.Error))
		}
		markdownLines = append(markdownLines, "")

		if payloadStr != "" {
			markdownLines = append(markdownLines, "#### Request Payload")
			markdownLines = append(markdownLines, "```json")
			markdownLines = append(markdownLines, payloadStr)
			markdownLines = append(markdownLines, "```")
			markdownLines = append(markdownLines, "")
		}

		if truncatedRespBodyStr != "" {
			markdownLines = append(markdownLines, "#### Response Body")
			if strings.HasPrefix(strings.TrimSpace(truncatedRespBodyStr), "{") || strings.HasPrefix(strings.TrimSpace(truncatedRespBodyStr), "[") {
				markdownLines = append(markdownLines, "```json")
			} else {
				markdownLines = append(markdownLines, "```")
			}
			markdownLines = append(markdownLines, truncatedRespBodyStr)
			markdownLines = append(markdownLines, "```")
		}

		markdownMessage := strings.Join(markdownLines, "\n")

		// Task 66: physicalLocation.artifactLocation.uri must be a proper URI — only
		// the path, never the HTTP method. Embedding the method caused SARIF viewers
		// (VS Code, GitHub Code Scanning) to apply RFC 3986 host normalisation to the
		// string, which title-cased each path segment (/api/bank → /Api/Bank).
		// The HTTP method is now carried in logicalLocations[0].name instead.
		results = append(results, map[string]any{
			"ruleId": f.RuleID,
			"level":  string(f.Level),
			"message": map[string]any{
				"text":     msg,
				"markdown": markdownMessage,
			},
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

func cweForRule(ruleID string) string {
	switch ruleID {
	case "swazz/bola-idor", "swazz/tenant-isolation-bypass":
		return "639"
	case "swazz/unauthorized-access":
		return "306"
	case "swazz/sensitive-data-leak", "swazz/response-size-anomaly":
		return "200"
	case "swazz/no-rate-limit":
		return "307"
	case "swazz/rate-limit-active":
		return "770"
	case "swazz/oob-interaction":
		return "918"
	case "swazz/cors-misconfig":
		return "942"
	case "swazz/csp-missing", "swazz/csp-unsafe-directive", "swazz/network-error",
		"swazz/x-frame-options-missing", "swazz/x-frame-options-insecure",
		"swazz/x-content-type-options-missing", "swazz/x-content-type-options-insecure":
		return "693"
	case "swazz/hsts-missing", "swazz/hsts-insecure":
		return "523"
	case "swazz/server-header-leak", "swazz/x-powered-by-leak", "swazz/x-aspnet-version-leak":
		return "200"
	case "swazz/crlf-injection", "swazz/header-injection":
		return "113"
	case "swazz/reflected-xss":
		return "79"
	case "swazz/rce-leak":
		return "94"
	case "swazz/time-based-sqli", "swazz/sql-error-leak":
		return "89"
	case "swazz/time-based-cmdi":
		return "78"
	case "swazz/stack-trace-leak":
		return "209"
	case "swazz/null-pointer-exception":
		return "476"
	case "swazz/timeout":
		return "400"
	default:
		return ""
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
