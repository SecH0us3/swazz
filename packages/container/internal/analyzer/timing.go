package analyzer

import (
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
)

// TimingAnalyzer detects time-based injection vulnerabilities (SQLi, CMDi)
// by measuring if the response time significantly exceeds the baseline
// when specific delay payloads are sent.
type TimingAnalyzer struct{}

func (a *TimingAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.BaselineTimeMs == 0 {
		return nil
	}

	threshold := int64(input.TimeThresholdMs)
	if threshold <= 0 {
		threshold = 4000
	}

	if input.Duration < input.BaselineTimeMs+threshold {
		return nil
	}

	payloadStr := fmt.Sprintf("%v", input.SentPayload)
	upper := strings.ToUpper(payloadStr)
	lower := strings.ToLower(payloadStr)

	isSqli := strings.Contains(upper, "SLEEP") ||
		strings.Contains(upper, "WAITFOR") ||
		strings.Contains(upper, "PG_SLEEP") ||
		strings.Contains(upper, "BENCHMARK(")

	isCmdi := strings.Contains(lower, ";sleep") ||
		strings.Contains(lower, "| sleep") ||
		strings.Contains(lower, "|sleep") ||
		strings.Contains(lower, "`sleep") ||
		strings.Contains(lower, "& sleep") ||
		strings.Contains(lower, "&sleep") ||
		strings.Contains(lower, "$(sleep")

	// Disambiguate overlap between generic "SLEEP" and specific CMDi payloads
	if isCmdi && !strings.Contains(upper, "BENCHMARK") && !strings.Contains(upper, "WAITFOR") && !strings.Contains(upper, "PG_SLEEP") {
		isSqli = false
	}

	var findings []swagger.AnalysisFinding
	if isSqli {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/time-based-sqli",
			Level:         "error",
			Message:       fmt.Sprintf("Time-Based SQL Injection detected. Response delayed by %dms (Baseline: %dms).", input.Duration, input.BaselineTimeMs),
			Evidence:      fmt.Sprintf("Payload: %v", input.SentPayload),
			OWASPCategory: []string{"A03:2021-Injection"},
		})
	} else if isCmdi {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/time-based-cmdi",
			Level:         "error",
			Message:       fmt.Sprintf("Time-Based Command Injection detected. Response delayed by %dms (Baseline: %dms).", input.Duration, input.BaselineTimeMs),
			Evidence:      fmt.Sprintf("Payload: %v", input.SentPayload),
			OWASPCategory: []string{"A03:2021-Injection"},
		})
	}

	return findings
}
