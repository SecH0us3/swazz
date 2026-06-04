package analyzer

import (
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
)

type CmdiAnalyzer struct{}

// cmdiSignatures contains common indicators of command execution in the response body.
var cmdiSignatures = []string{
	"uid=",
	"gid=",
	"groups=",
	"Microsoft Windows [Version",
	"nt authority\\system",
	"nt authority\\local service",
	"nt authority\\network service",
}

func (a *CmdiAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if len(input.ResponseBody) == 0 {
		return nil
	}

	bodyStr := string(input.ResponseBody)
	var findings []swagger.AnalysisFinding

	// Check for signatures of OS command output
	for _, sig := range cmdiSignatures {
		if strings.Contains(bodyStr, sig) {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/cmdi-leak",
				Level:    "error",
				Message:  fmt.Sprintf("OS Command Injection output signature '%s' detected in response body.", sig),
				Evidence: fmt.Sprintf("Found leaked signature: %s", sig),
			})
			break
		}
	}

	return findings
}
