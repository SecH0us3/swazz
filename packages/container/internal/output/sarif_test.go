package output

import (
	"reflect"
	"strings"
	"testing"

	"swazz-engine/internal/classifier"
)

func TestToSARIF(t *testing.T) {
	tests := []struct {
		name        string
		findings    []*classifier.Finding
		toolVersion string
		baseURL     *string
		verify      func(t *testing.T, output map[string]any)
	}{
		{
			name:        "Empty findings and default version",
			findings:    []*classifier.Finding{},
			toolVersion: "",
			verify: func(t *testing.T, output map[string]any) {
				if output["version"] != "2.1.0" {
					t.Errorf("expected version 2.1.0, got %v", output["version"])
				}
				runs := output["runs"].([]map[string]any)
				driver := runs[0]["tool"].(map[string]any)["driver"].(map[string]any)
				if driver["version"] != "1.0.0" {
					t.Errorf("expected default tool version 1.0.0, got %v", driver["version"])
				}
				if len(runs[0]["results"].([]map[string]any)) != 0 {
					t.Errorf("expected 0 results, got %v", len(runs[0]["results"].([]map[string]any)))
				}
			},
		},
		{
			name:        "Custom tool version",
			findings:    []*classifier.Finding{},
			toolVersion: "2.3.4",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				driver := runs[0]["tool"].(map[string]any)["driver"].(map[string]any)
				if driver["version"] != "2.3.4" {
					t.Errorf("expected tool version 2.3.4, got %v", driver["version"])
				}
			},
		},
		{
			name: "Rule deduplication",
			findings: []*classifier.Finding{
				{RuleID: "swazz/status-500", Level: classifier.SeverityError},
				{RuleID: "swazz/status-500", Level: classifier.SeverityError},
			},
			toolVersion: "1.0.0",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				rules := runs[0]["tool"].(map[string]any)["driver"].(map[string]any)["rules"].([]map[string]any)
				if len(rules) != 1 {
					t.Errorf("expected 1 rule due to deduplication, got %d", len(rules))
				}
				if rules[0]["id"] != "swazz/status-500" {
					t.Errorf("expected rule ID swazz/status-500, got %v", rules[0]["id"])
				}
			},
		},
		{
			name: "Description mapping and rule levels",
			findings: []*classifier.Finding{
				{RuleID: "swazz/timeout", Level: classifier.SeverityError},
				{RuleID: "swazz/network-error", Level: classifier.SeverityError},
				{RuleID: "swazz/status-500", Level: classifier.SeverityError},
				{RuleID: "swazz/status-400", Level: classifier.SeverityWarning},
				{RuleID: "swazz/status-200", Level: classifier.SeverityNote},
				{RuleID: "swazz/status-301", Level: classifier.SeverityNote},
				{RuleID: "unknown-rule", Level: classifier.SeverityNote},
			},
			toolVersion: "1.0.0",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				rules := runs[0]["tool"].(map[string]any)["driver"].(map[string]any)["rules"].([]map[string]any)

				expectedDescriptions := map[string]string{
					"swazz/timeout":       "Request timed out during fuzzing",
					"swazz/network-error": "Network error during fuzzing",
					"swazz/status-500":    "Server error 500 triggered by fuzz payload",
					"swazz/status-400":    "Client error 400 triggered by fuzz payload",
					"swazz/status-200":    "Unexpected success 200 with fuzz payload",
					"swazz/status-301":    "Unexpected status 301 from fuzz payload",
					"unknown-rule":        "Unexpected behavior detected by fuzzing",
				}

				expectedCWEs := map[string]string{
					"swazz/timeout":       "400",
					"swazz/network-error": "693",
				}

				for _, rule := range rules {
					id := rule["id"].(string)
					desc := rule["shortDescription"].(map[string]string)["text"]
					if desc != expectedDescriptions[id] {
						t.Errorf("rule %s: expected description %q, got %q", id, expectedDescriptions[id], desc)
					}

					if expectedCwe, exists := expectedCWEs[id]; exists {
						props, ok := rule["properties"].(map[string]any)
						if !ok {
							t.Errorf("rule %s: expected properties to be present", id)
						} else {
							cweVal, ok := props["cwe"].(string)
							if !ok || cweVal != expectedCwe {
								t.Errorf("rule %s: expected cwe %q, got %q", id, expectedCwe, cweVal)
							}
						}
					}
				}
			},
		},
		{
			name: "Result details and timestamp",
			findings: []*classifier.Finding{
				{
					RuleID:       "swazz/status-500",
					Level:        classifier.SeverityError,
					Method:       "POST",
					Endpoint:     "/api/v1/users",
					Profile:      "malicious",
					Timestamp:    1716352320000, // 2024-05-22T04:32:00Z
					Status:       500,
					Duration:     123,
					ResolvedPath: "/api/v1/users",
					Payload:      map[string]string{"name": "test"},
					ResponseBody: "Internal Server Error",
					Error:        "some internal error",
				},
			},
			toolVersion: "1.0.0",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				results := runs[0]["results"].([]map[string]any)
				if len(results) != 1 {
					t.Fatalf("expected 1 result, got %d", len(results))
				}
				res := results[0]

				if res["ruleId"] != "swazz/status-500" {
					t.Errorf("expected ruleId swazz/status-500, got %v", res["ruleId"])
				}
				if res["level"] != "error" {
					t.Errorf("expected level error, got %v", res["level"])
				}

				expectedMsg := "500 on POST /api/v1/users with malicious profile (some internal error)"
				msgObj, ok := res["message"].(map[string]any)
				if !ok {
					t.Fatalf("expected message to be a map")
				}
				if msgObj["text"] != expectedMsg {
					t.Errorf("expected message text %q, got %q", expectedMsg, msgObj["text"])
				}
				markdown, ok := msgObj["markdown"].(string)
				if !ok || markdown == "" {
					t.Errorf("expected message.markdown to be a non-empty string")
				} else {
					if !strings.Contains(markdown, "### Finding: swazz/status-500") {
						t.Errorf("expected markdown to contain finding header")
					}
					if !strings.Contains(markdown, "POST /api/v1/users") {
						t.Errorf("expected markdown to contain method/endpoint")
					}
					if !strings.Contains(markdown, "Internal Server Error") {
						t.Errorf("expected markdown to contain response body")
					}
				}

				loc := res["locations"].([]map[string]any)[0]
				// Task 66: uri must be path-only, no HTTP method
				uri := loc["physicalLocation"].(map[string]any)["artifactLocation"].(map[string]string)["uri"]
				if uri != "/api/v1/users" {
					t.Errorf("expected uri '/api/v1/users' (path only), got %q", uri)
				}
				// Task 66: method lives in logicalLocations
				logicalLocs := loc["logicalLocations"].([]map[string]any)
				if logicalLocs[0]["name"] != "POST" {
					t.Errorf("expected logicalLocations[0].name 'POST', got %q", logicalLocs[0]["name"])
				}

				props := res["properties"].(map[string]any)
				if props["timestamp"] != "2024-05-22T04:32:00Z" {
					t.Errorf("expected timestamp 2024-05-22T04:32:00Z, got %v", props["timestamp"])
				}
				if props["responseBody"] != "Internal Server Error" {
					t.Errorf("expected responseBody 'Internal Server Error', got %v", props["responseBody"])
				}
				if props["error"] != "some internal error" {
					t.Errorf("expected error 'some internal error', got %v", props["error"])
				}
				if !reflect.DeepEqual(props["payload"], map[string]string{"name": "test"}) {
					t.Errorf("payload mismatch")
				}

				// Verify properties.webRequest
				webReq, ok := props["webRequest"].(map[string]any)
				if !ok {
					t.Errorf("expected properties.webRequest to be map[string]any")
				} else {
					if webReq["method"] != "POST" {
						t.Errorf("expected webRequest.method to be POST, got %v", webReq["method"])
					}
					expectedURL := "http://localhost:8080/api/v1/users"
					if webReq["url"] != expectedURL {
						t.Errorf("expected webRequest.url to be %q, got %v", expectedURL, webReq["url"])
					}
					if !reflect.DeepEqual(webReq["body"], map[string]string{"name": "test"}) {
						t.Errorf("expected webRequest.body payload mismatch")
					}
				}

				// Verify properties.webResponse
				webResp, ok := props["webResponse"].(map[string]any)
				if !ok {
					t.Errorf("expected properties.webResponse to be map[string]any")
				} else {
					if webResp["statusCode"] != 500 {
						t.Errorf("expected webResponse.statusCode to be 500, got %v", webResp["statusCode"])
					}
					if webResp["body"] != "Internal Server Error" {
						t.Errorf("expected webResponse.body to be 'Internal Server Error', got %v", webResp["body"])
					}
				}
			},
		},
		{
			name: "Finding with Status 0 (Timeout)",
			findings: []*classifier.Finding{
				{
					RuleID:    "swazz/timeout",
					Level:     classifier.SeverityError,
					Method:    "GET",
					Endpoint:  "/slow",
					Profile:   "random",
					Timestamp: 1716352320000,
					Status:    0,
				},
			},
			toolVersion: "1.0.0",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				results := runs[0]["results"].([]map[string]any)
				res := results[0]
				expectedMsg := "TIMEOUT on GET /slow with random profile"
				msgObj := res["message"].(map[string]any)
				if msgObj["text"] != expectedMsg {
					t.Errorf("expected message text %q, got %q", expectedMsg, msgObj["text"])
				}
			},
		},
		{
			name: "Task 66: uri field contains path only, no HTTP method",
			findings: []*classifier.Finding{
				{
					RuleID:   "swazz/status-500",
					Level:    classifier.SeverityError,
					Method:   "DELETE",
					Endpoint: "/api/bank",
					Profile:  "RANDOM",
					Status:   500,
				},
			},
			toolVersion: "1.0.0",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				results := runs[0]["results"].([]map[string]any)
				loc := results[0]["locations"].([]map[string]any)[0]
				uri := loc["physicalLocation"].(map[string]any)["artifactLocation"].(map[string]string)["uri"]
				// Must be path-only — no HTTP method embedded
				if uri != "/api/bank" {
					t.Errorf("Task 66: expected uri '/api/bank', got %q", uri)
				}
				// Case must be preserved exactly as given
				if uri != "/api/bank" {
					t.Errorf("Task 66: uri casing changed, got %q", uri)
				}
				// HTTP method must be in logicalLocations
				logicalLocs := loc["logicalLocations"].([]map[string]any)
				if logicalLocs[0]["name"] != "DELETE" {
					t.Errorf("Task 66: expected logicalLocations[0].name 'DELETE', got %v", logicalLocs[0]["name"])
				}
			},
		},
		{
			name: "Task 64: rule properties contain profile tags",
			findings: []*classifier.Finding{
				{RuleID: "swazz/status-500", Level: classifier.SeverityError, Profile: "RANDOM"},
				{RuleID: "swazz/status-500", Level: classifier.SeverityError, Profile: "MALICIOUS"},
				{RuleID: "swazz/status-400", Level: classifier.SeverityWarning, Profile: "BOUNDARY"},
			},
			toolVersion: "1.0.0",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				rules := runs[0]["tool"].(map[string]any)["driver"].(map[string]any)["rules"].([]map[string]any)
				// Build a map for easy lookup
				rulesByID := make(map[string]map[string]any)
				for _, r := range rules {
					rulesByID[r["id"].(string)] = r
				}
				// swazz/status-500 fired with RANDOM and MALICIOUS
				r500, ok := rulesByID["swazz/status-500"]
				if !ok {
					t.Fatal("rule swazz/status-500 not found")
				}
				props, ok := r500["properties"].(map[string]any)
				if !ok {
					t.Fatal("Task 64: rule swazz/status-500 missing properties")
				}
				tags, ok := props["tags"].([]string)
				if !ok || len(tags) == 0 {
					t.Fatal("Task 64: rule swazz/status-500 missing tags")
				}
				tagSet := make(map[string]bool)
				for _, tag := range tags {
					tagSet[tag] = true
				}
				if !tagSet["RANDOM"] || !tagSet["MALICIOUS"] {
					t.Errorf("Task 64: expected RANDOM and MALICIOUS tags, got %v", tags)
				}
				// swazz/status-400 fired only with BOUNDARY
				r400 := rulesByID["swazz/status-400"]
				props400 := r400["properties"].(map[string]any)
				tags400 := props400["tags"].([]string)
				if len(tags400) != 1 || tags400[0] != "BOUNDARY" {
					t.Errorf("Task 64: expected [BOUNDARY] for swazz/status-400, got %v", tags400)
				}
			},
		},
		{
			name: "All CWE rule mapping",
			findings: []*classifier.Finding{
				{RuleID: "swazz/bola-idor", Level: classifier.SeverityError, ResolvedPath: "\x7finvalid-path"},
				{RuleID: "swazz/tenant-isolation-bypass", Level: classifier.SeverityError},
				{RuleID: "swazz/unauthorized-access", Level: classifier.SeverityError},
				{RuleID: "swazz/sensitive-data-leak", Level: classifier.SeverityError},
				{RuleID: "swazz/response-size-anomaly", Level: classifier.SeverityError},
				{RuleID: "swazz/no-rate-limit", Level: classifier.SeverityError},
				{RuleID: "swazz/rate-limit-active", Level: classifier.SeverityError},
				{RuleID: "swazz/oob-interaction", Level: classifier.SeverityError},
				{RuleID: "swazz/cors-misconfig", Level: classifier.SeverityError},
				{RuleID: "swazz/csp-missing", Level: classifier.SeverityError},
				{RuleID: "swazz/csp-unsafe-directive", Level: classifier.SeverityError},
				{RuleID: "swazz/network-error", Level: classifier.SeverityError},
				{RuleID: "swazz/crlf-injection", Level: classifier.SeverityError},
				{RuleID: "swazz/header-injection", Level: classifier.SeverityError},
				{RuleID: "swazz/reflected-xss", Level: classifier.SeverityError},
				{RuleID: "swazz/rce-leak", Level: classifier.SeverityError},
				{RuleID: "swazz/time-based-sqli", Level: classifier.SeverityError},
				{RuleID: "swazz/sql-error-leak", Level: classifier.SeverityError},
				{RuleID: "swazz/time-based-cmdi", Level: classifier.SeverityError},
				{RuleID: "swazz/stack-trace-leak", Level: classifier.SeverityError},
				{RuleID: "swazz/null-pointer-exception", Level: classifier.SeverityError},
				{RuleID: "swazz/timeout", Level: classifier.SeverityError},
				{RuleID: "unknown-rule", Level: classifier.SeverityError},
			},
			toolVersion: "1.0.0",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				rules := runs[0]["tool"].(map[string]any)["driver"].(map[string]any)["rules"].([]map[string]any)

				expectedCWEs := map[string]string{
					"swazz/bola-idor":                "639",
					"swazz/tenant-isolation-bypass": "639",
					"swazz/unauthorized-access":     "306",
					"swazz/sensitive-data-leak":     "200",
					"swazz/response-size-anomaly":   "200",
					"swazz/no-rate-limit":           "307",
					"swazz/rate-limit-active":       "770",
					"swazz/oob-interaction":         "918",
					"swazz/cors-misconfig":          "942",
					"swazz/csp-missing":             "693",
					"swazz/csp-unsafe-directive":    "693",
					"swazz/network-error":           "693",
					"swazz/crlf-injection":          "113",
					"swazz/header-injection":        "113",
					"swazz/reflected-xss":           "79",
					"swazz/rce-leak":                "94",
					"swazz/time-based-sqli":         "89",
					"swazz/sql-error-leak":          "89",
					"swazz/time-based-cmdi":         "78",
					"swazz/stack-trace-leak":        "209",
					"swazz/null-pointer-exception":  "476",
					"swazz/timeout":                 "400",
				}

				for _, rule := range rules {
					id := rule["id"].(string)
					expectedCwe, exists := expectedCWEs[id]
					props, hasProps := rule["properties"].(map[string]any)

					if exists {
						if !hasProps {
							t.Errorf("rule %s: expected properties to be present", id)
						} else {
							cweVal, ok := props["cwe"].(string)
							if !ok || cweVal != expectedCwe {
								t.Errorf("rule %s: expected cwe %q, got %q", id, expectedCwe, cweVal)
							}
						}
					} else {
						if hasProps {
							if _, ok := props["cwe"]; ok {
								t.Errorf("rule %s: did not expect cwe property to be present", id)
							}
						}
					}
				}
			},
		},
		{
			name: "BaseURL empty and invalid parse fallback",
			findings: []*classifier.Finding{
				{
					RuleID:       "swazz/status-500",
					Level:        classifier.SeverityError,
					Method:       "GET",
					Endpoint:     "/api/v1/users",
					ResolvedPath: "/api/v1/users",
					Status:       500,
				},
				{
					RuleID:       "swazz/status-500",
					Level:        classifier.SeverityError,
					Method:       "GET",
					Endpoint:     "/api/v1/users",
					ResolvedPath: "\x7finvalid-path",
					Status:       500,
				},
			},
			toolVersion: "1.0.0",
			baseURL:     func() *string { s := ""; return &s }(),
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				results := runs[0]["results"].([]map[string]any)
				if len(results) != 2 {
					t.Fatalf("expected 2 results, got %d", len(results))
				}

				// Check when baseURL is empty
				props0 := results[0]["properties"].(map[string]any)
				webReq0 := props0["webRequest"].(map[string]any)
				if webReq0["url"] != "/api/v1/users" {
					t.Errorf("expected URL to be '/api/v1/users', got %v", webReq0["url"])
				}

				// Check when ResolvedPath contains invalid URL chars
				props1 := results[1]["properties"].(map[string]any)
				webReq1 := props1["webRequest"].(map[string]any)
				if webReq1["url"] != "\x7finvalid-path" {
					t.Errorf("expected fallback URL to be '\\x7finvalid-path', got %v", webReq1["url"])
				}
			},
		},
		{
			name: "Invalid base URL parsing fallback",
			findings: []*classifier.Finding{
				{
					RuleID:       "swazz/status-500",
					Level:        classifier.SeverityError,
					Method:       "GET",
					Endpoint:     "/api/v1/users",
					ResolvedPath: "/api/v1/users",
					Status:       500,
				},
			},
			toolVersion: "1.0.0",
			baseURL:     func() *string { s := "\x7finvalid-base"; return &s }(),
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				results := runs[0]["results"].([]map[string]any)
				props := results[0]["properties"].(map[string]any)
				webReq := props["webRequest"].(map[string]any)
				if webReq["url"] != "\x7finvalid-base/api/v1/users" {
					t.Errorf("expected fallback URL to be '\\x7finvalid-base/api/v1/users', got %v", webReq["url"])
				}
			},
		},
		{
			name: "Invalid JSON payload and response body truncation",
			findings: []*classifier.Finding{
				{
					RuleID:       "swazz/status-500",
					Level:        classifier.SeverityError,
					Method:       "GET",
					Endpoint:     "/api/v1/users",
					ResolvedPath: "/api/v1/users",
					Status:       500,
					Payload:      make(chan int), // fails json.MarshalIndent
					ResponseBody: strings.Repeat("A", 2500), // > 2000 characters
				},
			},
			toolVersion: "1.0.0",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				results := runs[0]["results"].([]map[string]any)
				res := results[0]
				msgObj := res["message"].(map[string]any)
				markdown := msgObj["markdown"].(string)

				// Verify payload string fallback is in the markdown
				if !strings.Contains(markdown, "0x") {
					t.Errorf("expected markdown to contain fallback payload pointer address, got %q", markdown)
				}

				// Verify response body is truncated in the markdown
				if !strings.Contains(markdown, "... [TRUNCATED]") {
					t.Errorf("expected markdown to indicate response body is truncated")
				}
				if len(markdown) > 3000 {
					t.Errorf("expected markdown to be truncated to prevent bloat")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseURL := "http://localhost:8080"
			if tt.baseURL != nil {
				baseURL = *tt.baseURL
			}
			got := ToSARIF(tt.findings, tt.toolVersion, baseURL)
			tt.verify(t, got)
		})
	}
}
