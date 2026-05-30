package analyzer

import (
	"fmt"
	"swazz-engine/internal/swagger"
)

// SizeAnalyzer compares response size against baseline size to detect anomalies.
type SizeAnalyzer struct{}

// Analyze checks if the response size is significantly larger than the baseline median size during MALICIOUS profile runs.
func (a *SizeAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}
	if input.BaselineSize <= 0 {
		return nil
	}
	multiplier := input.SizeMultiplier
	if multiplier <= 0 {
		multiplier = 5.0
	}
	threshold := float64(input.BaselineSize) * multiplier
	if float64(input.ResponseSize) > threshold {
		ratio := float64(input.ResponseSize) / float64(input.BaselineSize)
		finding := swagger.AnalysisFinding{
			RuleID:   "swazz/response-size-anomaly",
			Level:    "warning",
			Message:  "Response size is significantly larger than the baseline median size, indicating potential data leakage.",
			Evidence: fmt.Sprintf("Baseline: %d bytes, Observed: %d bytes (%.1fx larger)", input.BaselineSize, input.ResponseSize, ratio),
		}
		return []swagger.AnalysisFinding{finding}
	}
	return nil
}
