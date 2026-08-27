// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/swagger"
)

func (r *Runner) executeMCPRequest(
	ctx context.Context,
	originalPath string,
	payload any,
	profile swagger.FuzzingProfile,
	identityHeaders map[string]string,
	identityCookies map[string]string,
) *swagger.FuzzResult {
	if r.mcpClient == nil {
		return &swagger.FuzzResult{
			ID:           uuid.New().String(),
			Endpoint:     originalPath,
			ResolvedPath: originalPath,
			Method:       "CALL",
			Profile:      profile,
			Payload:      payload,
			Status:       500,
			Error:        "MCP client is not initialized",
			ResponseBody: "Error: MCP client is not initialized",
			Timestamp:    time.Now().UnixMilli(),
		}
	}

	var args map[string]any
	if payload != nil {
		if m, ok := payload.(map[string]any); ok {
			args = m
		} else {
			if b, err := json.Marshal(payload); err == nil {
				_ = json.Unmarshal(b, &args)
			}
		}
	}

	payloadSize := 0
	if b, err := json.Marshal(args); err == nil {
		payloadSize = len(b)
	}

	timeoutMs := 10000
	r.configMu.RLock()
	if r.config.Settings.TimeoutMs > 0 {
		timeoutMs = r.config.Settings.TimeoutMs
	}
	r.configMu.RUnlock()

	reqCtx, reqCancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer reqCancel()

	// Initialize result early for potential early returns.
	// RequestHeaders records the identity this call actually went out with. The
	// BOLA phase reads it to decide whether a result is worth replaying (a call
	// with no auth header is skipped as unauthenticated), so an MCP result must
	// carry its auth header or BOLA never replays MCP tools under a second identity.
	result := &swagger.FuzzResult{
		ID:             uuid.New().String(),
		Endpoint:       originalPath,
		ResolvedPath:   originalPath,
		Method:         "CALL",
		Profile:        profile,
		Payload:        args,
		PayloadSize:    payloadSize,
		RequestHeaders: identityHeaders,
		Timestamp:      time.Now().UnixMilli(),
	}

	// Apply rate limiting to prevent DoS
	if r.mcpRateLimiter != nil && !r.mcpRateLimiter.Allow(reqCtx) {
		result.Error = "Rate limit exceeded for MCP calls"
		result.Status = 429
		result.ResponseBody = "Error: Too many concurrent MCP requests"
		return result
	}

	startTime := time.Now()
	// Per-call identity: the BOLA phase replays a tool as a second identity by
	// passing that identity's headers/cookies here. In the main phase these equal
	// the client's base headers, so applying them again is a harmless no-op. Build
	// a fresh map — identityHeaders may be the shared config.GlobalHeaders.
	var extraHeaders map[string]string
	if len(identityHeaders) > 0 || len(identityCookies) > 0 {
		extraHeaders = make(map[string]string, len(identityHeaders)+1)
		for k, v := range identityHeaders {
			extraHeaders[k] = r.subStateVars(v)
		}
		if len(identityCookies) > 0 {
			var parts []string
			for k, v := range identityCookies {
				parts = append(parts, fmt.Sprintf("%s=%s", k, v))
			}
			extraHeaders["Cookie"] = strings.Join(parts, "; ")
		}
	}

	var methodType string = "CALL"
	var resBytes []byte
	var isError bool
	var stderr string
	var err error

	if strings.HasPrefix(originalPath, "mcp://resource/") {
		methodType = "READ"
		uri := strings.TrimPrefix(originalPath, "mcp://resource/")
		if args != nil {
			if u, ok := args["uri"].(string); ok && u != "" {
				uri = u
			}
		}
		var readRes *mcp.ReadResourceResult
		readRes, stderr, err = r.mcpClient.ReadResource(reqCtx, uri, extraHeaders)
		if readRes != nil {
			resBytes, _ = json.Marshal(readRes)
		}
	} else if strings.HasPrefix(originalPath, "mcp://prompt/") {
		methodType = "PROMPT"
		promptName := strings.TrimPrefix(originalPath, "mcp://prompt/")
		var promptRes *mcp.GetPromptResult
		promptRes, stderr, err = r.mcpClient.GetPrompt(reqCtx, promptName, args, extraHeaders)
		if promptRes != nil {
			resBytes, _ = json.Marshal(promptRes)
		}
	} else {
		methodType = "CALL"
		toolName := strings.TrimPrefix(originalPath, "mcp://tool/")
		var callRes *mcp.CallToolResult
		callRes, stderr, err = r.mcpClient.CallTool(reqCtx, toolName, args, extraHeaders)
		if callRes != nil {
			isError = callRes.IsError
			resBytes, _ = json.Marshal(callRes)
			if isError {
				for _, content := range callRes.Content {
					if content.Type == "text" {
						textLower := strings.ToLower(content.Text)
						if strings.Contains(textLower, "exception") || strings.Contains(textLower, "stacktrace") || strings.Contains(textLower, "crash") || strings.Contains(textLower, "panic") {
							isError = true
							break
						}
					}
				}
			}
		}
	}
	result.Method = methodType

	duration := time.Since(startTime)

	// Update result with call details
	result.Duration = duration.Milliseconds()

	if err != nil {
		result.Status = 500
		result.Error = fmt.Sprintf("MCP execution failed: %v", err)
		if stderr != "" {
			result.ResponseBody = fmt.Sprintf("Error: %v\nStderr: %s", err, stderr)
		} else {
			result.ResponseBody = fmt.Sprintf("Error: %v", err)
		}
		errMsg := strings.ToLower(err.Error())
		// Check for server crash indicators more precisely
		isCrash := strings.Contains(errMsg, "exit status") || strings.Contains(errMsg, "process terminated") || 
			strings.Contains(errMsg, "channel closed") || strings.Contains(errMsg, "broken pipe") ||
			strings.Contains(errMsg, "signal") || strings.Contains(errMsg, "killed")
		if isCrash {
			result.AnalyzerFindings = append(result.AnalyzerFindings, swagger.AnalysisFinding{
				RuleID:   "swazz/mcp-server-crash",
				Level:    "error",
				Message:  "The MCP server crashed or returned a server error during invocation.",
				Evidence: fmt.Sprintf("Endpoint: %s\nError: %s\nStderr: %s", originalPath, err.Error(), stderr),
			})
		}
		return result
	}

	if isError {
		result.Status = 400
	} else {
		result.Status = 200
	}
	result.ResponseBody = string(resBytes)
	result.ResponseSize = int64(len(resBytes))

	if r.config.Settings.AnalyzeResponseBody {
		input := &analyzer.AnalysisInput{
			SentPayload:     result.Payload,
			ResponseBody:    resBytes,
			Duration:        duration.Milliseconds(),
			Profile:         profile,
			Endpoint:        originalPath,
			Method:          methodType,
			ResponseSize:    result.ResponseSize,
			BaselineSize:    0,
			SizeMultiplier:  5.0,
			BaselineTimeMs:  0,
			TimeThresholdMs: 0,
		}
		result.AnalyzerFindings = r.analyzer.Analyze(input)
	}

	return result
}
