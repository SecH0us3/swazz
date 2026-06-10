package analyzer

import (
	"bytes"
	"fmt"
	"regexp"
	"swazz-engine/internal/swagger"
)

type CmdiAnalyzer struct{}

// unixIdRegex matches the output of the Unix `id` command, e.g. "uid=1000(alex) gid=1000(alex) groups=..."
var unixIdRegex = regexp.MustCompile(`(uid|gid|groups)=\d+\([\w\-]+\)`)

// cmdiSignatures contains common indicators of Windows command execution in the response body.
var cmdiSignatures = [][]byte{
	[]byte("Microsoft Windows [Version"),
	[]byte("nt authority\\system"),
	[]byte("nt authority\\local service"),
	[]byte("nt authority\\network service"),
}

func (a *CmdiAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}
	if len(input.ResponseBody) == 0 {
		return nil
	}

	var findings []swagger.AnalysisFinding

	// Check for Unix id command output pattern (e.g. uid=1000(alex))
	if match := unixIdRegex.Find(input.ResponseBody); len(match) > 0 {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/cmdi-leak",
			Level:    "error",
			Message:  "OS Command Injection output signature (Unix id) detected in response body.",
			Evidence: fmt.Sprintf("Found leaked signature: %s", string(match)),
		})
		return findings
	}

	// Check for Windows command output signatures
	for _, sig := range cmdiSignatures {
		if bytes.Contains(input.ResponseBody, sig) {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/cmdi-leak",
				Level:    "error",
				Message:  fmt.Sprintf("OS Command Injection output signature '%s' detected in response body.", string(sig)),
				Evidence: fmt.Sprintf("Found leaked signature: %s", string(sig)),
			})
			break
		}
	}

	return findings
}
