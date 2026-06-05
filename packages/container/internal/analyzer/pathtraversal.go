package analyzer

import (
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
)

type PathTraversalAnalyzer struct{}

var pathTraversalSignatures = []string{
	"root:x:0:0:",
	"/bin/sh",
	"/bin/bash",
	"[extensions]",
	"[fonts]",
	"[mci extensions]",
}

func (a *PathTraversalAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}
	if len(input.ResponseBody) == 0 {
		return nil
	}

	bodyStr := string(input.ResponseBody)
	var findings []swagger.AnalysisFinding

	for _, sig := range pathTraversalSignatures {
		if strings.Contains(bodyStr, sig) {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/path-traversal-leak",
				Level:    "error",
				Message:  fmt.Sprintf("Path traversal or file inclusion leak signature '%s' detected in response body.", sig),
				Evidence: fmt.Sprintf("Found leaked signature: %s", sig),
			})
			break
		}
	}

	return findings
}
