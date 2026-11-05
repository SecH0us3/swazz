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
	baseURL, resolvedPath, originalPath, method string,
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

	// A client keeps no connection (each exchange opens its own), so one per request costs nothing
	// and lets exchanges with the same endpoint run in parallel.
	client := ws.NewClient(r.allowPrivateIPs())

	// Each exchange is bounded like an HTTP or gRPC request: the run's context alone would let a
	// target that accepts the connection and never answers stall the scan.
	timeoutMs := 10000
	r.configMu.RLock()
	settings := r.config.Settings
	r.configMu.RUnlock()
	if settings.TimeoutMs > 0 {
		timeoutMs = settings.TimeoutMs
	}
	reqCtx, reqCancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer reqCancel()

	respMsg, status, err := client.SendMessage(reqCtx, urlStr, payloadBytes, mergedHeaders)

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

	// Analysed like an HTTP response, against the endpoint's size and time baselines. The close
	// code and transport error (the X-Swazz-WS-* headers) are always checked; the body only when
	// the scan asks for response analysis. An exchange that failed or timed out says nothing about
	// how long the target took to answer, so it is not compared with the time baseline.
	if r.analyzer != nil {
		baselineSize, multiplier, baselineTime := r.anomalyBaselines(method, originalPath, profile, settings)
		if err != nil {
			baselineTime = 0
		}
		body := respMsg
		if !settings.AnalyzeResponseBody {
			body = nil
		}
		// The analyzers read the payload as the HTTP executor hands it over: as values, not as the
		// encoded bytes, which none of them looks into (every payload check missed on WebSocket).
		var sent any = payload
		if b, ok := payload.([]byte); ok {
			sent = string(b)
		}
		input := analyzer.AcquireInput(analyzer.AnalysisInput{
			SentPayload:     sent,
			ResponseBody:    body,
			ResponseHeaders: resHeaders,
			Duration:        duration,
			Profile:         profile,
			Endpoint:        urlStr,
			Method:          "WS",
			ResponseSize:    int64(len(respMsg)),
			BaselineSize:    baselineSize,
			SizeMultiplier:  multiplier,
			BaselineTimeMs:  baselineTime,
			TimeThresholdMs: settings.TimeAnomalyThresholdMs,
			Settings:        settings,
		})
		result.AnalyzerFindings = r.analyzer.Analyze(input)
		analyzer.ReleaseInput(input)
	}

	return result
}
