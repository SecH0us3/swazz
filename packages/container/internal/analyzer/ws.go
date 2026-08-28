// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"strings"

	"swazz-engine/internal/swagger"
)

// WSStatusAnalyzer detects abnormal WebSocket closures, internal server errors, or panic text.
type WSStatusAnalyzer struct {
}

func NewWSStatusAnalyzer() ResponseAnalyzer {
	return &WSStatusAnalyzer{}
}

func (a *WSStatusAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if input.Method != "WS" && !strings.HasPrefix(input.Endpoint, "ws://") && !strings.HasPrefix(input.Endpoint, "wss://") {
		return nil
	}

	var findings []swagger.AnalysisFinding
	owasp := []string{"A05:2021-Security Misconfiguration", "A04:2021-Insecure Design"}

	status := input.ResponseHeaders.Get("X-Swazz-WS-Status")
	wsError := input.ResponseHeaders.Get("X-Swazz-WS-Error")

	if status == "500" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/ws-crash-detected",
			Level:         "error",
			Message:       "WebSocket connection closed abnormally (equivalent to HTTP 500) or dropped unexpectedly.",
			Evidence:      wsError,
			OWASPCategory: owasp,
		})
	} else if status == "504" {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/ws-timeout",
			Level:         "warning",
			Message:       "WebSocket request timed out without receiving a response frame.",
			Evidence:      "Timeout",
			OWASPCategory: owasp,
		})
	}

	// Check response body for panic/internal error strings
	if len(input.ResponseBody) > 0 {
		lowerResp := strings.ToLower(string(input.ResponseBody))
		if strings.Contains(lowerResp, "panic:") || strings.Contains(lowerResp, "internal error") || strings.Contains(lowerResp, "runtime error:") {
			findings = append(findings, swagger.AnalysisFinding{
				RuleID:        "swazz/ws-internal-error-leak",
				Level:         "error",
				Message:       "WebSocket response frame contains internal stack traces, panics, or unhandled error messages.",
				Evidence:      string(input.ResponseBody),
				OWASPCategory: []string{"A05:2021-Security Misconfiguration"},
			})
		}
	}

	if wsError != "" && (strings.Contains(wsError, "EOF") || strings.Contains(wsError, "connection reset by peer")) {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:        "swazz/ws-eof-drop",
			Level:         "error",
			Message:       "WebSocket connection dropped abruptly (EOF or connection reset).",
			Evidence:      wsError,
			OWASPCategory: owasp,
		})
	}

	return findings
}
