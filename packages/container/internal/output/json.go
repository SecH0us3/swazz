package output

import (
	"time"

	"swazz-engine/internal/classifier"
	"swazz-engine/internal/swagger"
)

// ToJSON generates a structured JSON report.
func ToJSON(findings []*classifier.Finding, stats *swagger.RunStats, version string) map[string]any {
	if version == "" {
		version = "1.0.0"
	}

	var errors, warnings, notes int
	for _, f := range findings {
		switch f.Level {
		case classifier.SeverityError:
			errors++
		case classifier.SeverityWarning:
			warnings++
		case classifier.SeverityNote:
			notes++
		}
	}

	durationSec := int64(0)
	if stats != nil && stats.StartTime > 0 {
		durationSec = (time.Now().UnixMilli() - stats.StartTime) / 1000
	}

	totalRequests := int64(0)
	var statusCounts map[int]int64
	if stats != nil {
		totalRequests = stats.TotalRequests
		statusCounts = stats.StatusCounts
	}

	return map[string]any{
		"tool":      "swazz",
		"version":   version,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"summary": map[string]any{
			"totalRequests": totalRequests,
			"totalFindings": len(findings),
			"byLevel": map[string]int{
				"error":   errors,
				"warning": warnings,
				"note":    notes,
			},
			"statusCounts":    statusCounts,
			"durationSeconds": durationSec,
		},
		"findings": findings,
	}
}
