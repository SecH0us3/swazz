// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"swazz-engine/internal/analyzer"
	swazzGrpc "swazz-engine/internal/grpc"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/proto"
	"swazz-engine/internal/swagger"
)

func (r *Runner) executeGRPCRequest(
	ctx context.Context,
	baseURL, resolvedPath, originalPath string,
	payload any,
	profile swagger.FuzzingProfile,
	generatedHeaders map[string]string,
) *swagger.FuzzResult {
	timeoutMs := 10000
	if r != nil && r.config != nil {
		r.configMu.RLock()
		if r.config.Settings.TimeoutMs > 0 {
			timeoutMs = r.config.Settings.TimeoutMs
		}
		r.configMu.RUnlock()
	}

	reqCtx, reqCancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer reqCancel()

	mergedHeaders := make(map[string]string)
	for k, v := range generatedHeaders {
		if r != nil {
			mergedHeaders[k] = r.subStateVars(v)
		} else {
			mergedHeaders[k] = v
		}
	}
	if r != nil && r.config != nil {
		r.configMu.RLock()
		for k, v := range r.config.GlobalHeaders {
			mergedHeaders[k] = r.subStateVars(r.subVarsLocked(v))
		}
		r.configMu.RUnlock()
	}

	targetAddr := baseURL
	if targetAddr == "" && r != nil && r.config != nil {
		targetAddr = r.config.BaseURL
	}
	isTLS := strings.HasPrefix(strings.ToLower(targetAddr), "grpcs://")
	cleanAddr := strings.TrimPrefix(targetAddr, "grpc://")
	cleanAddr = strings.TrimPrefix(cleanAddr, "grpcs://")

	var client *swazzGrpc.Client
	if r != nil {
		client = r.getGRPCClient(cleanAddr, isTLS, mergedHeaders)
	} else {
		client = swazzGrpc.NewClient(cleanAddr, isTLS, mergedHeaders)
	}

	method := resolvedPath
	if method == "" {
		method = originalPath
	}
	if !strings.HasPrefix(method, "/") {
		method = "/" + method
	}

	md := proto.GetMethodInputDescriptor(originalPath)
	if md == nil {
		md = proto.GetMethodInputDescriptor(resolvedPath)
	}

	binPayload, _ := swazzGrpc.MarshalPayload(md, payload)
	payloadSize := len(binPayload)

	start := time.Now()
	respBytes, statusCode, callErr := client.Invoke(reqCtx, method, binPayload, generatedHeaders)
	duration := time.Since(start).Milliseconds()

	var respBody any
	var rawBodyBytes []byte
	var errStr string

	outMd := proto.GetMethodOutputDescriptor(originalPath)
	if outMd == nil {
		outMd = proto.GetMethodOutputDescriptor(resolvedPath)
	}

	if len(respBytes) > 0 {
		if outMd == nil {
			logger.Debug("[GRPC] No output descriptor for %s; response unmarshaled as raw string", method)
		}
		resMap, jsonStr, unmarshalErr := swazzGrpc.UnmarshalResponse(outMd, respBytes)
		if unmarshalErr == nil && resMap != nil {
			respBody = resMap
			rawBodyBytes = []byte(jsonStr)
		} else {
			respBody = string(respBytes)
			rawBodyBytes = respBytes
		}
	}

	if callErr != nil {
		errStr = callErr.Error()
		if len(rawBodyBytes) > 0 {
			rawBodyBytes = []byte(fmt.Sprintf("%s\n%s", errStr, string(rawBodyBytes)))
			respBody = string(rawBodyBytes)
		} else {
			rawBodyBytes = []byte(errStr)
			respBody = errStr
		}
	}

	responseSize := int64(len(respBytes))
	if responseSize == 0 && len(rawBodyBytes) > 0 {
		responseSize = int64(len(rawBodyBytes))
	}

	result := &swagger.FuzzResult{
		ID:             uuid.New().String(),
		Endpoint:       originalPath,
		ResolvedPath:   resolvedPath,
		Method:         "GRPC",
		Profile:        profile,
		Status:         statusCode,
		Duration:       duration,
		Payload:        payload,
		PayloadSize:    payloadSize,
		ResponseBody:   respBody,
		ResponseSize:   responseSize,
		RequestHeaders: mergedHeaders,
		Error:          errStr,
		Timestamp:      time.Now().UnixMilli(),
	}

	if r != nil && r.config != nil && r.config.Settings.AnalyzeResponseBody && r.analyzer != nil {
		input := &analyzer.AnalysisInput{
			SentPayload:     result.Payload,
			ResponseBody:    rawBodyBytes,
			Duration:        duration,
			Profile:         profile,
			Endpoint:        originalPath,
			Method:          "GRPC",
			ResponseSize:    responseSize,
			BaselineSize:    0,
			SizeMultiplier:  5.0,
			BaselineTimeMs:  0,
			TimeThresholdMs: 0,
			Settings:        r.config.Settings,
		}
		result.AnalyzerFindings = r.analyzer.Analyze(input)
	}

	return result
}
