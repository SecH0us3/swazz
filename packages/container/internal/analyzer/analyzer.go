// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"net/http"
	"swazz-engine/internal/swagger"
)

// AnalysisInput represents the input payload and response metadata used for body analysis.
type AnalysisInput struct {
	SentPayload     any
	ResponseBody    []byte
	ResponseHeaders http.Header
	Duration        int64
	Profile         swagger.FuzzingProfile
	Endpoint        string
	Method          string
	ResponseSize    int64
	BaselineSize    int64
	SizeMultiplier  float64
	BaselineTimeMs  int64
	TimeThresholdMs int
}

// ResponseAnalyzer is the interface implemented by each specific vulnerability scanner.
type ResponseAnalyzer interface {
	Analyze(input *AnalysisInput) []swagger.AnalysisFinding
}
