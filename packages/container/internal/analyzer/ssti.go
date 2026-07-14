package analyzer

import (
	"bytes"
	"fmt"
	"strings"
	"swazz-engine/internal/sstistore"
	"swazz-engine/internal/swagger"
)

type SSTIAnalyzer struct{}

var sstiRawExprBytes = map[string][]byte{
	"7*7":   []byte("7*7"),
	"7+'7'": []byte("7+'7'"),
}

var sstiEvalValBytes = map[string][]byte{
	"7*7":   []byte("49"),
	"7+'7'": []byte("77"),
}

func (a *SSTIAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}

	sentStrings := extractStrings(input.SentPayload)
	if len(sentStrings) == 0 {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, payloadStr := range sentStrings {
		if payloadStr == "" {
			continue
		}

		// First, check dynamic store
		if ctx, ok := sstistore.GlobalStore.Get(payloadStr); ok {
			evalValBytes := []byte(ctx.Expected)
			rawExprBytes := []byte(ctx.RawExpr)
			if hasStandaloneNumber(input.ResponseBody, evalValBytes) && !bytes.Contains(input.ResponseBody, rawExprBytes) {
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:   "swazz/ssti-leak",
					Level:    "error",
					Message:  fmt.Sprintf("SSTI math expression '%s' evaluated to '%s' in the response without raw expression reflection.", ctx.RawExpr, ctx.Expected),
					Evidence: fmt.Sprintf("Payload: %s | Evaluated: %s", payloadStr, ctx.Expected),
				})
				break
			}
			continue
		}

		// Fallback for static/non-registered payloads
		for rawExpr, rawExprBytes := range sstiRawExprBytes {
			if strings.Contains(payloadStr, rawExpr) {
				evalValBytes := sstiEvalValBytes[rawExpr]
				if hasStandaloneNumber(input.ResponseBody, evalValBytes) && !bytes.Contains(input.ResponseBody, rawExprBytes) {
					evalVal := string(evalValBytes)
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
func hasStandaloneNumber(body, val []byte) bool {
	idx := 0
	for {
		i := bytes.Index(body[idx:], val)
		if i == -1 {
			return false
		}
		start := idx + i
		end := start + len(val)

		beforeOk := true
		if start > 0 {
			c := body[start-1]
			if c >= '0' && c <= '9' {
				beforeOk = false
			}
		}

		afterOk := true
		if end < len(body) {
			c := body[end]
			if c >= '0' && c <= '9' {
				afterOk = false
			}
		}

		if beforeOk && afterOk {
			return true
		}
		idx = end
	}
}
