package output

import (
	"encoding/json"
	"testing"
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

func TestToJSON(t *testing.T) {
	// Case 1: Empty findings, null stats, default version
	t.Run("Empty findings and null stats", func(t *testing.T) {
		res := ToJSON(nil, nil, "")

		if res["tool"] != "swazz" {
			t.Errorf("expected tool to be 'swazz', got %v", res["tool"])
		}
		if res["version"] != "1.0.0" {
			t.Errorf("expected version to be '1.0.0', got %v", res["version"])
		}

		timestamp, ok := res["timestamp"].(string)
		if !ok {
			t.Errorf("timestamp is missing or not a string")
		} else {
			_, err := time.Parse(time.RFC3339, timestamp)
			if err != nil {
				t.Errorf("failed to parse timestamp RFC3339: %v", err)
			}
		}

		summary, ok := res["summary"].(map[string]any)
		if !ok {
			t.Fatalf("summary is missing or not map[string]any")
		}

		if summary["totalRequests"] != int64(0) {
			t.Errorf("expected totalRequests to be 0, got %v", summary["totalRequests"])
		}
		if summary["totalFindings"] != 0 {
			t.Errorf("expected totalFindings to be 0, got %v", summary["totalFindings"])
		}

		byLevel, ok := summary["byLevel"].(map[string]int)
		if !ok {
			t.Fatalf("byLevel is missing or not map[string]int")
		}
		if byLevel["error"] != 0 || byLevel["warning"] != 0 || byLevel["note"] != 0 {
			t.Errorf("expected all byLevel counts to be 0, got %v", byLevel)
		}

		if sc, ok := summary["statusCounts"].(map[int]int64); !ok || sc != nil {
			t.Errorf("expected statusCounts to be nil, got %v", summary["statusCounts"])
		}
		if summary["durationSeconds"] != int64(0) {
			t.Errorf("expected durationSeconds to be 0, got %v", summary["durationSeconds"])
		}
	})

	// Case 2: Custom version and mixed severity findings
	t.Run("Custom version and mixed severity findings", func(t *testing.T) {
		findings := []*classifier.Finding{
			{Level: classifier.SeverityError},
			{Level: classifier.SeverityError},
			{Level: classifier.SeverityWarning},
			{Level: classifier.SeverityNote},
		}

		res := ToJSON(findings, nil, "2.3.4")

		if res["version"] != "2.3.4" {
			t.Errorf("expected version to be '2.3.4', got %v", res["version"])
		}

		summary := res["summary"].(map[string]any)
		if summary["totalFindings"] != 4 {
			t.Errorf("expected totalFindings to be 4, got %v", summary["totalFindings"])
		}

		byLevel := summary["byLevel"].(map[string]int)
		if byLevel["error"] != 2 {
			t.Errorf("expected error count 2, got %d", byLevel["error"])
		}
		if byLevel["warning"] != 1 {
			t.Errorf("expected warning count 1, got %d", byLevel["warning"])
		}
		if byLevel["note"] != 1 {
			t.Errorf("expected note count 1, got %d", byLevel["note"])
		}
	})

	// Case 3: RunStats integration and duration calculation
	t.Run("RunStats integration and duration", func(t *testing.T) {
		fiveSecsAgo := time.Now().UnixMilli() - 5000
		stats := &swagger.RunStats{
			TotalRequests: 150,
			StatusCounts:  map[int]int64{200: 140, 500: 10},
			StartTime:     fiveSecsAgo,
		}

		res := ToJSON(nil, stats, "")

		summary := res["summary"].(map[string]any)
		if summary["totalRequests"] != int64(150) {
			t.Errorf("expected totalRequests to be 150, got %v", summary["totalRequests"])
		}

		statusCounts, ok := summary["statusCounts"].(map[int]int64)
		if !ok {
			t.Fatalf("statusCounts is missing or invalid type")
		}
		if statusCounts[200] != 140 || statusCounts[500] != 10 {
			t.Errorf("statusCounts mismatch: got %v", statusCounts)
		}

		duration, ok := summary["durationSeconds"].(int64)
		if !ok {
			t.Fatalf("durationSeconds is missing or not int64")
		}
		// Duration should be around 5 seconds (allow 4 to 7 to avoid flake)
		if duration < 4 || duration > 7 {
			t.Errorf("expected durationSeconds to be around 5, got %d", duration)
		}
	})

	// Case 4: JSON Round-trip stability
	t.Run("JSON Marshal/Unmarshal round-trip", func(t *testing.T) {
		findings := []*classifier.Finding{
			{
				RuleID:       "swazz/status-500",
				Level:        classifier.SeverityError,
				Method:       "POST",
				Endpoint:     "/api/v1/users",
				Status:       500,
				ResponseBody: "internal error",
			},
		}
		stats := &swagger.RunStats{
			TotalRequests: 42,
			StatusCounts:  map[int]int64{500: 1},
		}

		report := ToJSON(findings, stats, "1.0.0")

		data, err := json.Marshal(report)
		if err != nil {
			t.Fatalf("failed to marshal report to JSON: %v", err)
		}

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		if err != nil {
			t.Fatalf("failed to unmarshal JSON back to map: %v", err)
		}

		if parsed["tool"] != "swazz" {
			t.Errorf("tool mismatch after roundtrip")
		}
		if parsed["version"] != "1.0.0" {
			t.Errorf("version mismatch after roundtrip")
		}

		summary := parsed["summary"].(map[string]any)
		// Go unmarshals JSON numbers as float64 by default
		if summary["totalRequests"].(float64) != 42 {
			t.Errorf("totalRequests mismatch after roundtrip: got %v", summary["totalRequests"])
		}

		parsedFindings := parsed["findings"].([]any)
		if len(parsedFindings) != 1 {
			t.Fatalf("expected 1 finding after roundtrip, got %d", len(parsedFindings))
		}

		finding := parsedFindings[0].(map[string]any)
		if finding["ruleId"] != "swazz/status-500" {
			t.Errorf("finding ruleId mismatch: got %v", finding["ruleId"])
		}
		if finding["method"] != "POST" {
			t.Errorf("finding method mismatch: got %v", finding["method"])
		}
		if finding["endpoint"] != "/api/v1/users" {
			t.Errorf("finding endpoint mismatch: got %v", finding["endpoint"])
		}
	})
}
