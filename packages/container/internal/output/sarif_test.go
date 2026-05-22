package output

import (
	"reflect"
	"testing"
	"time"

	"swazz-engine/internal/classifier"
)

func TestToSARIF(t *testing.T) {
	tests := []struct {
		name        string
		findings    []*classifier.Finding
		toolVersion string
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
					"swazz/status-500":     "Server error 500 triggered by fuzz payload",
					"swazz/status-400":     "Client error 400 triggered by fuzz payload",
					"swazz/status-200":     "Unexpected success 200 with fuzz payload",
					"swazz/status-301":     "Unexpected status 301 from fuzz payload",
					"unknown-rule":        "Unexpected behavior detected by fuzzing",
				}

				for _, rule := range rules {
					id := rule["id"].(string)
					desc := rule["shortDescription"].(map[string]string)["text"]
					if desc != expectedDescriptions[id] {
						t.Errorf("rule %s: expected description %q, got %q", id, expectedDescriptions[id], desc)
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
				if res["message"].(map[string]string)["text"] != expectedMsg {
					t.Errorf("expected message %q, got %q", expectedMsg, res["message"].(map[string]string)["text"])
				}

				loc := res["locations"].([]map[string]any)[0]
				uri := loc["physicalLocation"].(map[string]any)["artifactLocation"].(map[string]string)["uri"]
				if uri != "POST /api/v1/users" {
					t.Errorf("expected uri 'POST /api/v1/users', got %q", uri)
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
					Timestamp: time.Now().UnixMilli(),
					Status:    0,
				},
			},
			toolVersion: "1.0.0",
			verify: func(t *testing.T, output map[string]any) {
				runs := output["runs"].([]map[string]any)
				results := runs[0]["results"].([]map[string]any)
				res := results[0]
				expectedMsg := "TIMEOUT on GET /slow with random profile"
				if res["message"].(map[string]string)["text"] != expectedMsg {
					t.Errorf("expected message %q, got %q", expectedMsg, res["message"].(map[string]string)["text"])
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ToSARIF(tt.findings, tt.toolVersion)
			tt.verify(t, got)
		})
	}
}
