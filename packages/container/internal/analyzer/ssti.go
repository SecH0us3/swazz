package analyzer

import (
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
)

type SSTIAnalyzer struct{}

var sstiExpressions = map[string]string{
	"7*7":   "49",
	"7+'7'": "77",
}

func (a *SSTIAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}

	sentStrings := extractStrings(input.SentPayload)
	if len(sentStrings) == 0 {
		return nil
	}

	bodyStr := string(input.ResponseBody)
	var findings []swagger.AnalysisFinding

	for _, payloadStr := range sentStrings {
		if payloadStr == "" {
			continue
		}

		for rawExpr, evalVal := range sstiExpressions {
			if strings.Contains(payloadStr, rawExpr) {
				// Checks if the response contains its evaluated math value without containing the raw expression itself
				if strings.Contains(bodyStr, evalVal) && !strings.Contains(bodyStr, rawExpr) {
					findings = append(findings, swagger.AnalysisFinding{
						RuleID:   "swazz/ssti-leak",
						Level:    "error",
						Message:  fmt.Sprintf("SSTI math expression '%s' evaluated to '%s' in the response without raw expression reflection.", rawExpr, evalVal),
						Evidence: fmt.Sprintf("Payload: %s | Evaluated: %s", payloadStr, evalVal),
					})
					break
				}
			}
		}
	}

	return findings
}
