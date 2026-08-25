// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/ws"
)

func (r *Runner) executeWebSocketRequest(
	ctx context.Context,
	baseURL, resolvedPath, originalPath string,
	payload any,
	profile swagger.FuzzingProfile,
	globalHeaders map[string]string,
	generatedHeaders map[string]string,
) *swagger.FuzzResult {
	start := time.Now()
	urlStr := baseURL
	if resolvedPath != "" {
		if strings.HasSuffix(urlStr, "/") && strings.HasPrefix(resolvedPath, "/") {
			urlStr += resolvedPath[1:]
		} else if !strings.HasSuffix(urlStr, "/") && !strings.HasPrefix(resolvedPath, "/") {
			urlStr += "/" + resolvedPath
		} else {
			urlStr += resolvedPath
		}
	}

	mergedHeaders := make(map[string]string)
	for k, v := range generatedHeaders {
		mergedHeaders[k] = r.subStateVars(v)
	}
	r.configMu.RLock()
	for k, v := range r.config.GlobalHeaders {
		mergedHeaders[k] = r.subStateVars(v)
	}
	for k, v := range globalHeaders {
		mergedHeaders[k] = r.subStateVars(v)
	}
	r.configMu.RUnlock()

	var payloadBytes []byte
	switch p := payload.(type) {
	case []byte:
		payloadBytes = p
	case string:
		payloadBytes = []byte(p)
	default:
		payloadBytes, _ = json.Marshal(payload)
	}

	result := &swagger.FuzzResult{
		ID:             uuid.New().String(),
		Endpoint:       urlStr,
		ResolvedPath:   resolvedPath,
		Method:         "WS",
		Profile:        profile,
		Payload:        payload,
		PayloadSize:    len(payloadBytes),
		Timestamp:      time.Now().UnixMilli(),
		RequestHeaders: mergedHeaders,
	}

	// Try to get or create client for this URL
	var client *ws.Client
	c, ok := r.wsClients.Load(urlStr)
	if !ok {
		client = ws.NewClient()
		r.wsClients.Store(urlStr, client)
	} else {
		client = c.(*ws.Client)
	}

	respMsg, status, err := client.SendMessage(ctx, urlStr, payloadBytes, mergedHeaders)

	duration := time.Since(start).Milliseconds()
	result.Duration = duration
	result.Status = status

	resHeaders := make(http.Header)
	resHeaders.Set("X-Swazz-WS-Status", strconv.Itoa(status))

	if err != nil {
		result.Error = err.Error()
		resHeaders.Set("X-Swazz-WS-Error", err.Error())
	}
	if len(respMsg) > 0 {
		result.ResponseSize = int64(len(respMsg))
		// try json
		var js any
		if json.Unmarshal(respMsg, &js) == nil {
			result.ResponseBody = js
		} else {
			result.ResponseBody = string(respMsg)
		}
	}
	result.ResponseHeaders = resHeaders

	input := &analyzer.AnalysisInput{
		SentPayload:     payloadBytes,
		ResponseBody:    respMsg,
		ResponseHeaders: resHeaders,
		Duration:        duration,
		Profile:         profile,
		Endpoint:        urlStr,
		Method:          "WS",
		ResponseSize:    int64(len(respMsg)),
	}

	analyzerChain := analyzer.NewRegistry()
	result.AnalyzerFindings = analyzerChain.Analyze(input)

	return result
}
