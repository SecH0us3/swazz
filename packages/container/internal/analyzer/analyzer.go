// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"fmt"
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
	Settings        swagger.Settings

	// Views derived from the fields above, computed on first use and shared by every analyzer
	// of one Analyze call. An input belongs to one response and one goroutine: build a new one
	// per response rather than reusing or sharing it.
	lowered     string
	loweredDone bool
	sent        []string
	sentDone    bool
	payloadStr  string
	payloadDone bool
}

// lowerBody returns ResponseBody with ASCII letters lowercased. Only ASCII is folded, so a
// lowercase ASCII needle is found in it exactly where containsFoldASCII would find it.
func (in *AnalysisInput) lowerBody() string {
	if !in.loweredDone {
		in.lowered = lowerASCII(in.ResponseBody)
		in.loweredDone = true
	}
	return in.lowered
}

// sentStrings returns the string leaves of SentPayload (see extractStrings).
func (in *AnalysisInput) sentStrings() []string {
	if !in.sentDone {
		in.sent = extractStrings(in.SentPayload)
		in.sentDone = true
	}
	return in.sent
}

// payloadText returns SentPayload formatted with %v, map keys included.
func (in *AnalysisInput) payloadText() string {
	if !in.payloadDone {
		in.payloadStr = fmt.Sprintf("%v", in.SentPayload)
		in.payloadDone = true
	}
	return in.payloadStr
}

// ResponseAnalyzer is the interface implemented by each specific vulnerability scanner.
type ResponseAnalyzer interface {
	Analyze(input *AnalysisInput) []swagger.AnalysisFinding
}
