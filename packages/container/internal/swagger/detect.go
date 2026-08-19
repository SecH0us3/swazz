// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package swagger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// IsValidSpec checks if the given raw JSON is a valid OpenAPI/Swagger specification
// or a GraphQL Introspection result.
func IsValidSpec(raw json.RawMessage) bool {
	var check map[string]any
	if err := json.Unmarshal(raw, &check); err != nil {
		return false
	}

	if _, hasOpenAPI := check["openapi"]; hasOpenAPI {
		return true
	}
	if _, hasSwagger := check["swagger"]; hasSwagger {
		return true
	}
	if _, hasData := check["data"]; hasData {
		if dataMap, ok := check["data"].(map[string]any); ok {
			if _, hasSchema := dataMap["__schema"]; hasSchema {
				return true
			}
		}
	}
	if _, hasSchema := check["__schema"]; hasSchema {
		return true
	}

	return false
}

// IsWSDL checks if the given raw bytes represent a WSDL specification.
func IsWSDL(raw []byte) bool {
	content := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(content, "<?xml") && !strings.HasPrefix(content, "<") {
		return false
	}
	return strings.Contains(content, "<definitions") || strings.Contains(content, "<wsdl:definitions")
}


// IsHAR checks if the given raw JSON represents a HAR file.
func IsHAR(raw []byte) bool {
	var check map[string]any
	if err := json.Unmarshal(raw, &check); err != nil {
		return false
	}
	if log, ok := check["log"].(map[string]any); ok {
		if _, ok := log["entries"].([]any); ok {
			return true
		}
	}
	return false
}

// IsPostman checks if the given raw JSON represents a Postman Collection.
func IsPostman(raw []byte) bool {
	var check map[string]any
	if err := json.Unmarshal(raw, &check); err != nil {
		return false
	}

	info, hasInfo := check["info"].(map[string]any)
	if !hasInfo {
		return false
	}

	schema, _ := info["schema"].(string)
	_, hasItem := check["item"].([]any)
	return hasItem && (strings.Contains(schema, "schema.getpostman.com") || schema != "")
}

// FetchRemoteSpec fetches a specification from a URL, trying GET first, and then trying POST with the provided GraphQL introspection query if GET does not return a valid spec.
func FetchRemoteSpec(ctx context.Context, client *http.Client, urlStr string, headers map[string]string, gqlIntrospectionQuery string) (json.RawMessage, error) {
	// 1. Try GET request first
	// #nosec G107 -- URL is user-controlled by design in this fuzzer tool
	req, err := http.NewRequestWithContext(ctx, "GET", urlStr, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json, application/yaml, application/x-yaml, text/yaml, text/x-yaml, text/xml, application/xml")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	hasUA := false
	for k := range headers {
		if strings.EqualFold(k, "User-Agent") {
			hasUA = true
			break
		}
	}
	if !hasUA {
		req.Header.Set("User-Agent", "Swazz/1.0 (+https://github.com/SecH0us3/swazz)")
	}

	// codeql[go/request-forgery]
	resp, err := client.Do(req)
	var body []byte
	var lastStatus int
	if err == nil {
		defer resp.Body.Close()
		lastStatus = resp.StatusCode
		if resp.StatusCode == http.StatusOK {
			body, err = io.ReadAll(io.LimitReader(resp.Body, 10*1024*1024)) // 10MB limit
			if err == nil {
				if converted, convErr := ConvertYAMLToJSON(body); convErr == nil {
					body = converted
				}

				if IsValidSpec(body) || IsWSDL(body) || IsPostman(body) || IsHAR(body) {
					return body, nil
				}
			}
		}
	}

	// 2. Try POST Introspection if GET failed or didn't return a valid spec
	gqlQuery := map[string]string{
		"query": gqlIntrospectionQuery,
	}
	gqlBody, err := json.Marshal(gqlQuery)
	if err != nil {
		return nil, err
	}

	// #nosec G107 -- URL is user-controlled by design in this fuzzer tool
	postReq, err := http.NewRequestWithContext(ctx, "POST", urlStr, bytes.NewBuffer(gqlBody))
	if err != nil {
		return nil, err
	}
	postReq.Header.Set("Content-Type", "application/json")
	postReq.Header.Set("Accept", "application/json")
	for k, v := range headers {
		postReq.Header.Set(k, v)
	}
	hasUA = false
	for k := range headers {
		if strings.EqualFold(k, "User-Agent") {
			hasUA = true
			break
		}
	}
	if !hasUA {
		postReq.Header.Set("User-Agent", "Swazz/1.0 (+https://github.com/SecH0us3/swazz)")
	}

	// codeql[go/request-forgery]
	postResp, err := client.Do(postReq)
	if err != nil {
		if body != nil {
			return body, nil
		}
		if lastStatus == http.StatusUnauthorized || lastStatus == http.StatusForbidden {
			return nil, fmt.Errorf("authentication required (HTTP %d). Please configure custom headers or cookies in the right panel", lastStatus)
		}
		return nil, fmt.Errorf("failed to fetch via GET and POST: %w", err)
	}
	defer postResp.Body.Close()

	lastStatus = postResp.StatusCode
	if postResp.StatusCode == http.StatusOK {
		postBody, err := io.ReadAll(io.LimitReader(postResp.Body, 10*1024*1024)) // 10MB limit
		if err == nil {
			if IsValidSpec(postBody) || IsPostman(postBody) || IsHAR(postBody) {
				return postBody, nil
			}
		}
	}

	if body != nil {
		return body, nil
	}
	if lastStatus == http.StatusUnauthorized || lastStatus == http.StatusForbidden {
		return nil, fmt.Errorf("authentication required (HTTP %d). Please configure custom headers or cookies in the right panel", lastStatus)
	}
	return nil, fmt.Errorf("spec server returned status %d on POST introspection request", postResp.StatusCode)
}

// IsGRPCURL reports whether the URL targets a gRPC server (grpc:// or grpcs://).
func IsGRPCURL(urlStr string) bool {
	lower := strings.ToLower(strings.TrimSpace(urlStr))
	return strings.HasPrefix(lower, "grpc://") || strings.HasPrefix(lower, "grpcs://")
}

// IsProtoFile reports whether raw bytes look like a .proto source file.
func IsProtoFile(raw []byte) bool {
	content := strings.TrimSpace(string(raw))
	if len(content) == 0 {
		return false
	}
	// Avoid false-positives on JSON or XML
	if (strings.HasPrefix(content, "{") && strings.HasSuffix(content, "}")) ||
		(strings.HasPrefix(content, "[") && strings.HasSuffix(content, "]")) ||
		strings.HasPrefix(content, "<?xml") || strings.HasPrefix(content, "<definitions") {
		return false
	}
	if strings.HasPrefix(content, "syntax = \"proto3\"") || strings.HasPrefix(content, "syntax = \"proto2\"") ||
		strings.HasPrefix(content, "syntax=\"proto3\"") || strings.HasPrefix(content, "syntax=\"proto2\"") ||
		strings.HasPrefix(content, "syntax = 'proto3'") || strings.HasPrefix(content, "syntax = 'proto2'") {
		return true
	}
	if (strings.Contains(content, "service ") || strings.Contains(content, "message ")) &&
		strings.Contains(content, "rpc ") {
		return true
	}
	if strings.Contains(content, "message ") && strings.Contains(content, "package ") && strings.Contains(content, ";") {
		return true
	}
	return false
}

// IsWSURL reports whether the URL targets a WebSocket server (ws:// or wss://).
func IsWSURL(urlStr string) bool {
	lower := strings.ToLower(strings.TrimSpace(urlStr))
	return strings.HasPrefix(lower, "ws://") || strings.HasPrefix(lower, "wss://")
}

// IsAsyncAPISpec checks if the given raw JSON represents an AsyncAPI specification.
func IsAsyncAPISpec(raw []byte) bool {
	var check map[string]any
	if err := json.Unmarshal(raw, &check); err != nil {
		return false
	}
	if _, ok := check["asyncapi"]; ok {
		return true
	}
	return false
}


