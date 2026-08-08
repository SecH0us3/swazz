// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package triage

import (
	"encoding/json"
	"fmt"
	"strings"

	"swazz-engine/internal/swagger"
)

const maxResponseBodyLen = 2000

// SystemPrompt defines the triage analyst persona and output guidelines.
const SystemPrompt = `You are an expert API security vulnerability triage analyst.
Your job is to analyze HTTP request/response evidence from an automated security scanner and determine if the finding is a genuine security vulnerability (true_positive) or a noisy false positive (false_positive).

Rules for classification:
- SQL syntax errors, database driver stack traces, unhandled exceptions revealing sensitive paths/credentials, or verified file inclusion contents in the response body MUST be classified as true_positive.
- Generic 500 Internal Server Errors resulting from standard input validation failures, expected type mismatches, benign rate limits, or expected authorization rejections with no data leak MUST be classified as false_positive.
- If uncertain or if the response reveals suspicious internal state, classify as true_positive with lower confidence.

Respond ONLY with a valid JSON object in the following format:
{
  "classification": "true_positive" | "false_positive",
  "confidence": <integer between 0 and 100>,
  "reasoning": "<1-2 sentence explanation of your decision>"
}`

// BuildPrompt constructs the user prompt for the LLM with untrusted content delimiters.
func BuildPrompt(finding *swagger.AnalysisFinding, result *swagger.FuzzResult) string {
	if finding == nil {
		return ""
	}

	var method, endpoint string
	var statusCode int
	var responseSize int64
	var durationMs int64
	var responseBodyStr string

	if result != nil {
		method = result.Method
		endpoint = result.Endpoint
		statusCode = result.Status
		responseSize = result.ResponseSize
		durationMs = result.Duration

		if result.ResponseBody != nil {
			if s, ok := result.ResponseBody.(string); ok {
				responseBodyStr = s
			} else {
				b, _ := json.Marshal(result.ResponseBody)
				responseBodyStr = string(b)
			}
		}
	}

	if len(responseBodyStr) > maxResponseBodyLen {
		responseBodyStr = responseBodyStr[:maxResponseBodyLen] + "\n... [truncated]"
	}

	evidence := finding.Evidence
	if evidence == "" {
		evidence = "None provided"
	}

	userPrompt := fmt.Sprintf(`## Finding Details
- Rule ID: %s
- Level: %s
- Scanner Message: %s
- Evidence: %s

## HTTP Context
- Method & Endpoint: %s %s
- Status Code: %d
- Response Size: %d bytes
- Response Time: %d ms

## Response Body Evidence
<untrusted-scan-context>
%s
</untrusted-scan-context>

Analyze this evidence and provide your triage classification JSON object.`,
		finding.RuleID,
		finding.Level,
		finding.Message,
		evidence,
		method,
		endpoint,
		statusCode,
		responseSize,
		durationMs,
		strings.TrimSpace(responseBodyStr),
	)

	return userPrompt
}
