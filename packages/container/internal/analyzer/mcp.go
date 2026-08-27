// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package analyzer

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"swazz-engine/internal/swagger"
)

var (
	mcpPrivateKeyRx = regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`)
	mcpJwtRx        = regexp.MustCompile(`eyJ[A-Za-z0-9-_=]{10,}\.eyJ[A-Za-z0-9-_=]{10,}\.[A-Za-z0-9-_.+/=]*`)
	mcpAwsKeyRx     = regexp.MustCompile(`\b(AKIA[0-9A-Z]{16})\b`)
	mcpDbConnRx     = regexp.MustCompile(`(?i)\b(postgres|postgresql|mysql|mongodb|redis|amqp)://[a-zA-Z0-9_\-\.]+:[^@\s]+@`)
	mcpPromptInjRx  = regexp.MustCompile(`(?i)(ignore\s+previous\s+instructions|system\s+prompt:|<\s*system\s*>|human:\s*ignore|assistant:\s*ignore)`)
)

// MCPStatusAnalyzer inspects MCP tool execution results and responses for crashes, leaks, and vulnerabilities.
type MCPStatusAnalyzer struct{}

func (a *MCPStatusAnalyzer) isMCPEndpoint(input *AnalysisInput) bool {
	return input.Method == "CALL" ||
		input.Method == "READ" ||
		input.Method == "PROMPT" ||
		strings.HasPrefix(input.Endpoint, "mcp://") ||
		strings.Contains(input.Endpoint, "/mcp/")
}

// Analyze inspects MCP response payloads for crashes, unhandled runtime exceptions, prompt reflections, resource leaks, and secret leaks.
func (a *MCPStatusAnalyzer) Analyze(input *AnalysisInput) []swagger.AnalysisFinding {
	if !a.isMCPEndpoint(input) {
		return nil
	}

	bodyStr := string(input.ResponseBody)
	if len(bodyStr) == 0 {
		return nil
	}
	bodyLower := strings.ToLower(bodyStr)

	var findings []swagger.AnalysisFinding

	// 1. Process Crash / Transport Disconnect
	if strings.Contains(bodyLower, "exit status") ||
		strings.Contains(bodyLower, "process terminated") ||
		strings.Contains(bodyLower, "broken pipe") ||
		strings.Contains(bodyLower, "connection reset by peer") ||
		strings.Contains(bodyLower, "stdio mcp transport cannot switch identity") {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/mcp-server-crash",
			Level:    "error",
			Message:  "The MCP server subprocess or transport dropped connection or crashed during tool execution.",
			Evidence: bodyStr,
		})
	}

	// 2. Unhandled Runtime Exceptions / Stack Traces
	isException := strings.Contains(bodyLower, "traceback (most recent call last)") ||
		strings.Contains(bodyLower, "unhandledpromiserejection") ||
		strings.Contains(bodyLower, "typeerror: cannot read properties") ||
		strings.Contains(bodyLower, "panic: runtime error") ||
		strings.Contains(bodyLower, "attributeerror:") ||
		strings.Contains(bodyLower, "zerodivisionerror:") ||
		strings.Contains(bodyLower, "keyerror:") ||
		strings.Contains(bodyLower, "referenceerror:") ||
		strings.Contains(bodyLower, "fatal error: runtime:")
	if isException {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/mcp-tool-exception",
			Level:    "error",
			Message:  "The MCP tool raised an unhandled runtime exception or stack trace.",
			Evidence: bodyStr,
		})
	}

	// 3. Secret Exposure in Tool Content (Fast guards before regex)
	hasSecret := false
	if strings.Contains(bodyStr, "-----BEGIN ") && mcpPrivateKeyRx.MatchString(bodyStr) {
		hasSecret = true
	} else if strings.Contains(bodyStr, "AKIA") && mcpAwsKeyRx.MatchString(bodyStr) {
		hasSecret = true
	} else if strings.Contains(bodyStr, "://") && mcpDbConnRx.MatchString(bodyStr) {
		hasSecret = true
	} else if strings.Contains(bodyStr, "eyJ") && mcpJwtRx.MatchString(bodyStr) {
		hasSecret = true
	}
	if hasSecret {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/mcp-secret-leak",
			Level:    "critical",
			Message:  "The MCP tool output returned raw private credentials, tokens, or database connection strings.",
			Evidence: bodyStr,
		})
	}

	// 4. Prompt Injection Reflection Check (Fast guards before regex)
	if input.SentPayload != nil {
		if strings.Contains(bodyLower, "ignore") || strings.Contains(bodyLower, "system") || strings.Contains(bodyLower, "assistant") || strings.Contains(bodyLower, "human") {
			payloadBytes, _ := json.Marshal(input.SentPayload)
			payloadStr := string(payloadBytes)
			if mcpPromptInjRx.MatchString(payloadStr) && mcpPromptInjRx.MatchString(bodyStr) {
				findings = append(findings, swagger.AnalysisFinding{
					RuleID:   "swazz/mcp-prompt-injection-reflection",
					Level:    "warning",
					Message:  "Injected prompt manipulation sequences were reflected in the MCP tool output, indicating vulnerability to indirect prompt injection.",
					Evidence: fmt.Sprintf("Injected: %s\nReflected in response: %s", payloadStr, bodyStr),
				})
			}
		}
	}

	// 5. Sensitive File and Resource Traversal Leakage
	if strings.Contains(bodyStr, "root:x:0:0:") ||
		strings.Contains(bodyStr, "[extensions]") ||
		strings.Contains(bodyStr, "[fonts]") ||
		strings.Contains(bodyStr, "ami-id") ||
		strings.Contains(bodyStr, "instance-id") ||
		strings.Contains(bodyStr, "security-credentials") {
		findings = append(findings, swagger.AnalysisFinding{
			RuleID:   "swazz/mcp-resource-leak",
			Level:    "critical",
			Message:  "The MCP resource read exposed local system files or cloud instance metadata.",
			Evidence: bodyStr,
		})
	}

	return findings
}
