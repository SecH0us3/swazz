package analyzer

import (
	"fmt"
	"regexp"
	"strings"
	"swazz-engine/internal/swagger"
)

type CmdiAnalyzer struct{}

// unixIdRegex matches the output of the Unix `id` command, e.g. "uid=1000(alex) gid=1000(alex) groups=..."
var unixIdRegex = regexp.MustCompile(`(uid|gid|groups)=\d+\([\w\-]+\)`)

// cmdiSignatures contains common indicators of Windows command execution in the response body.
var cmdiSignatures = []string{
	"Microsoft Windows [Version",
	"nt authority\\system",
	"nt authority\\local service",
	"nt authority\\network service",
}

func (a *CmdiAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}
	if len(input.ResponseBody) == 0 {
		return nil
	}

	bodyStr := string(input.ResponseBody)
	var findings []swagger.AnalysisFinding

	// Check for Unix id command output pattern (e.g. uid=1000(alex))
	if match := unixIdRegex.FindString(bodyStr); match != "" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/cmdi-leak",
			Level:    "error",
			Message:  "OS Command Injection output signature (Unix id) detected in response body.",
			Evidence: fmt.Sprintf("Found leaked signature: %s", match),
		})
		return findings
	}

	// Check for Windows command output signatures
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
