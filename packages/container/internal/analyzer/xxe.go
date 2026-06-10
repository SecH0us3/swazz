package analyzer

import (
	"bytes"
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
)

type XXEAnalyzer struct{}

var xxeFileSignatures = [][]byte{
	[]byte("root:x:0:0:"),
	[]byte("/bin/sh"),
	[]byte("/bin/bash"),
	[]byte("[extensions]"),
	[]byte("[fonts]"),
	[]byte("[mci extensions]"),
}

func (a *XXEAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}

	sentStrings := extractStrings(input.SentPayload)
	if len(sentStrings) == 0 {
		return nil
	}

	// Check if any of the sent payloads look like an XML/XXE payload
	isXXEPayload := false
	for _, s := range sentStrings {
		lower := strings.ToLower(s)
		if strings.Contains(lower, "<?xml") ||
			strings.Contains(lower, "<!doctype") ||
			strings.Contains(lower, "<!entity") {
			isXXEPayload = true
			break
		}
	}

	if !isXXEPayload {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range xxeFileSignatures {
		if bytes.Contains(input.ResponseBody, sig) {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/xxe-leak",
				Level:    "error",
				Message:  fmt.Sprintf("XXE leak detected. File signature '%s' found in response body when XML/XXE payload was sent.", string(sig)),
				Evidence: fmt.Sprintf("Found leaked signature: %s", string(sig)),
			})
			break
		}
	}

	return findings
}
