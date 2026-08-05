// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"bytes"
	"fmt"
	"swazz-engine/internal/swagger"
)

type PathTraversalAnalyzer struct{}

var pathTraversalSignatures = [][]byte{
	[]byte("root:x:0:0:"),
	[]byte("/bin/sh"),
	[]byte("/bin/bash"),
	[]byte("[extensions]"),
	[]byte("[fonts]"),
	[]byte("[mci extensions]"),
}

func (a *PathTraversalAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Profile != swagger.ProfileMalicious {
		return nil
	}
	if len(input.ResponseBody) == 0 {
		return nil
	}

	var findings []swagger.AnalysisFinding

	for _, sig := range pathTraversalSignatures {
		if bytes.Contains(input.ResponseBody, sig) {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:   "swazz/path-traversal-leak",
				Level:    "error",
				Message:  fmt.Sprintf("Path traversal or file inclusion leak signature '%s' detected in response body.", string(sig)),
				Evidence: fmt.Sprintf("Found leaked signature: %s", string(sig)),
			})
			break
		}
	}

	return findings
}
