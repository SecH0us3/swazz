package analyzer

import (
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
	"unicode"
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
				// Match evaluated value as a standalone number (not adjacent to other digits)
				// and ensure the raw expression itself was not simply reflected back.
				if hasStandaloneNumber(bodyStr, evalVal) && !strings.Contains(bodyStr, rawExpr) {
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

// hasStandaloneNumber returns true if val appears in body as a standalone number,
// i.e. not immediately adjacent to other digit characters.
func hasStandaloneNumber(body, val string) bool {
	idx := 0
	for {
		i := strings.Index(body[idx:], val)
		if i == -1 {
			return false
		}
		start := idx + i
		end := start + len(val)

		beforeOk := true
		if start > 0 {
			if unicode.IsDigit(rune(body[start-1])) {
				beforeOk = false
			}
		}

		afterOk := true
		if end < len(body) {
			if unicode.IsDigit(rune(body[end])) {
				afterOk = false
			}
		}

		if beforeOk && afterOk {
			return true
		}
		idx = end
	}
}
