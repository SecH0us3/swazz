package output

import (
	"strings"
	"testing"
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

func TestCrossFormatConsistency(t *testing.T) {
	// Feed the same []*classifier.Finding + *swagger.RunStats to ToHTML, ToJSON, ToSARIF
	findings := []*classifier.Finding{
		{
			RuleID:    "swazz/status-500",
			Level:     classifier.SeverityError,
			Method:    "POST",
			Endpoint:  "/api/v1/users",
			Status:    500,
			Profile:   "RANDOM",
			Timestamp: time.Now().UnixMilli(),
		},
		{
			RuleID:    "swazz/status-400",
			Level:     classifier.SeverityWarning,
			Method:    "GET",
			Endpoint:  "/api/v1/users",
			Status:    400,
			Profile:   "BOUNDARY",
			Timestamp: time.Now().UnixMilli(),
		},
		{
			RuleID:    "swazz/status-200",
			Level:     classifier.SeverityNote,
			Method:    "GET",
			Endpoint:  "/api/v1/items",
			Status:    200,
			Profile:   "MALICIOUS",
			Timestamp: time.Now().UnixMilli(),
		},
	}

	stats := &swagger.RunStats{
		TotalRequests: 100,
		StartTime:     time.Now().UnixMilli() - 5000,
		Progress: swagger.Progress{
			TotalEndpoints: 2,
		},
	}

	// 1. Generate reports
	htmlReport := ToHTML(findings, stats)
	jsonReport := ToJSON(findings, stats, "1.2.3")
	sarifReport := ToSARIF(findings, "1.2.3")

	// 2. Assert finding counts match across all formats
	// JSON count: len(jsonReport["findings"])
	jsonFindings, ok := jsonReport["findings"].([]*classifier.Finding)
	if !ok {
		t.Fatalf("expected JSON findings to be []*classifier.Finding")
	}
	if len(jsonFindings) != len(findings) {
		t.Errorf("JSON report findings count mismatch: expected %d, got %d", len(findings), len(jsonFindings))
	}

	// SARIF count: len(runs[0].results)
	runs, ok := sarifReport["runs"].([]map[string]any)
	if !ok || len(runs) == 0 {
		t.Fatalf("expected SARIF runs to be non-empty slice of maps")
	}
	results, ok := runs[0]["results"].([]map[string]any)
	if !ok {
		t.Fatalf("expected SARIF results to be slice of maps")
	}
	if len(results) != len(findings) {
		t.Errorf("SARIF report findings count mismatch: expected %d, got %d", len(findings), len(results))
	}

	// HTML count: check number of level-* class instances or count groups.
	if !strings.Contains(htmlReport, "level-error") || !strings.Contains(htmlReport, "level-warning") || !strings.Contains(htmlReport, "level-note") {
		t.Errorf("HTML report does not contain all severity level classes")
	}

	// 3. Assert severity distribution is identical
	// Counts in findings: 1 error, 1 warning, 1 note
	// In JSON:
	summary, ok := jsonReport["summary"].(map[string]any)
	if !ok {
		t.Fatalf("JSON summary is missing")
	}
	byLevel, ok := summary["byLevel"].(map[string]int)
	if !ok {
		t.Fatalf("JSON byLevel is missing")
	}
	if byLevel["error"] != 1 || byLevel["warning"] != 1 || byLevel["note"] != 1 {
		t.Errorf("JSON byLevel distribution mismatch: got %+v", byLevel)
	}

	// In SARIF: severity levels mapped to 'error', 'warning', 'note'
	sarifErrors, sarifWarnings, sarifNotes := 0, 0, 0
	for _, res := range results {
		switch res["level"] {
		case string(classifier.SeverityError):
			sarifErrors++
		case string(classifier.SeverityWarning):
			sarifWarnings++
		case string(classifier.SeverityNote):
			sarifNotes++
		}
	}
	if sarifErrors != 1 || sarifWarnings != 1 || sarifNotes != 1 {
		t.Errorf("SARIF severity distribution mismatch: error=%d warning=%d note=%d", sarifErrors, sarifWarnings, sarifNotes)
	}

	// 4. Assert no formatter panics on edge case inputs
	t.Run("Edge case inputs safety", func(t *testing.T) {
		edgeFindings := []*classifier.Finding{
			{
				RuleID:       "",
				Level:        "",
				Method:       "",
				Endpoint:     "",
				Status:       0,
				Profile:      "",
				Payload:      nil,
				ResponseBody: nil,
			},
			{
				RuleID:       "unknown-rule",
				Level:        "unknown-level",
				Method:       "PATCH",
				Endpoint:     "https://verylongurl.com/" + strings.Repeat("x", 1000),
				Status:       -1,
				Profile:      "unknown-profile",
				Payload:      map[string]any{"nested": []any{map[string]any{"k": "v"}, nil, 123}},
				ResponseBody: []any{"a", "b", "c", "d", "e", "f", "g"},
			},
		}
		edgeStats := &swagger.RunStats{
			TotalRequests: -10,
			StartTime:     -100,
			Progress: swagger.Progress{
				TotalEndpoints: -5,
			},
		}

		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("formatter panicked on edge case inputs: %v", r)
			}
		}()

		ToHTML(edgeFindings, edgeStats)
		ToJSON(edgeFindings, edgeStats, "edge")
		ToSARIF(edgeFindings, "edge")
	})
}
