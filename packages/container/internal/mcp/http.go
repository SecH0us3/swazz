// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package mcp

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"swazz-engine/internal/security"
)

// HTTPClient implements the Client interface using simple HTTP POST JSON-RPC.
type HTTPClient struct {
	url        string
	httpClient *http.Client
	nextID     uint64
	headers    map[string]string
}

// NewHTTPClient initializes a new HTTPClient.
func NewHTTPClient(urlStr string, allowPrivateIPs bool, headers map[string]string) *HTTPClient {
	client := security.NewSSRFProtectedClient(30*time.Second, allowPrivateIPs)
	
	// Always enable certificate validation by default
	if transport, ok := client.Transport.(*http.Transport); ok {
		if transport.TLSClientConfig == nil {
			transport.TLSClientConfig = &tls.Config{
				InsecureSkipVerify: false,
				MinVersion:         tls.VersionTLS12,
			}
		}
	}
	
	return &HTTPClient{
		url:        urlStr,
		httpClient: client,
		headers:    headers,
	}
}

// Connect performs the initialize handshake.
func (c *HTTPClient) Connect(ctx context.Context) error {
	// Perform initialize handshake
	if err := c.initializeHandshake(ctx); err != nil {
		return fmt.Errorf("handshake failed: %w", err)
	}
	return nil
}

func (c *HTTPClient) sendRequest(ctx context.Context, method string, params json.RawMessage, extraHeaders map[string]string) (*Response, error) {
	id := atomic.AddUint64(&c.nextID, 1)
	reqObj := Request{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      id,
	}

	reqBytes, err := json.Marshal(reqObj)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.url, bytes.NewReader(reqBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}
	// Per-call identity overrides win over the client's base headers.
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		limitReader := io.LimitReader(resp.Body, 4096)
		respBytes, _ := io.ReadAll(limitReader)
		return nil, fmt.Errorf("HTTP request failed with status %d: %s", resp.StatusCode, string(bytes.TrimSpace(respBytes)))
	}

	contentType := resp.Header.Get("Content-Type")

	limitReader := io.LimitReader(resp.Body, 10*1024*1024)
	respBytes, err := io.ReadAll(limitReader)
	if err != nil {
		return nil, err
	}

	// Some non-standard MCP servers respond to POST with an SSE stream containing the JSON-RPC response.
	if strings.Contains(contentType, "text/event-stream") {
		// Extract the 'data: ' payload
		lines := strings.Split(string(respBytes), "\n")
		var dataPayload []string
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "data:") {
				dataPayload = append(dataPayload, strings.TrimSpace(line[5:]))
			}
		}
		if len(dataPayload) > 0 {
			respBytes = []byte(strings.Join(dataPayload, "\n"))
		}
	}

	var respObj Response
	if err := json.Unmarshal(respBytes, &respObj); err != nil {
		return nil, err
	}

	return &respObj, nil
}

func (c *HTTPClient) initializeHandshake(ctx context.Context) error {
	initParams := map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]any{},
		"clientInfo": map[string]any{
			"name":    "swazz-client",
			"version": "1.0.0",
		},
	}
	paramsBytes, err := json.Marshal(initParams)
	if err != nil {
		return err
	}

	resp, err := c.sendRequest(ctx, "initialize", paramsBytes, nil)
	if err != nil {
		return err
	}
	if resp.Error != nil {
		return fmt.Errorf("initialize error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}
	return nil
}

// ListTools retrieves the list of tools from the HTTP JSON-RPC server.
func (c *HTTPClient) ListTools(ctx context.Context) ([]Tool, error) {
	resp, err := c.sendRequest(ctx, "tools/list", nil, nil)
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("tools/list error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	var result struct {
		Tools []Tool `json:"tools"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal tools/list result: %w", err)
	}
	return result.Tools, nil
}

// CallTool invokes a tool on the HTTP JSON-RPC server.
func (c *HTTPClient) CallTool(ctx context.Context, name string, arguments map[string]any, extraHeaders map[string]string) (*CallToolResult, string, error) {
	params := map[string]any{
		"name":      name,
		"arguments": arguments,
	}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return nil, "", err
	}

	resp, err := c.sendRequest(ctx, "tools/call", paramsBytes, extraHeaders)
	if err != nil {
		return nil, "", err
	}
	if resp.Error != nil {
		return nil, "", fmt.Errorf("tools/call error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	var result CallToolResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal tools/call result: %w", err)
	}
	result.RawJSON = resp.Result
	return &result, "", nil
}

// ListResources retrieves the list of resources from the HTTP JSON-RPC server.
func (c *HTTPClient) ListResources(ctx context.Context) ([]Resource, error) {
	resp, err := c.sendRequest(ctx, "resources/list", nil, nil)
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("resources/list error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	var result struct {
		Resources []Resource `json:"resources"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal resources/list result: %w", err)
	}
	return result.Resources, nil
}

// ReadResource reads a resource by URI from the HTTP JSON-RPC server.
func (c *HTTPClient) ReadResource(ctx context.Context, uri string, extraHeaders map[string]string) (*ReadResourceResult, string, error) {
	params := map[string]any{"uri": uri}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return nil, "", err
	}

	resp, err := c.sendRequest(ctx, "resources/read", paramsBytes, extraHeaders)
	if err != nil {
		return nil, "", err
	}
	if resp.Error != nil {
		return nil, "", fmt.Errorf("resources/read error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	var result ReadResourceResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal resources/read result: %w", err)
	}
	result.RawJSON = resp.Result
	return &result, "", nil
}

// ListPrompts retrieves the list of prompts from the HTTP JSON-RPC server.
func (c *HTTPClient) ListPrompts(ctx context.Context) ([]Prompt, error) {
	resp, err := c.sendRequest(ctx, "prompts/list", nil, nil)
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("prompts/list error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	var result struct {
		Prompts []Prompt `json:"prompts"`
	}
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal prompts/list result: %w", err)
	}
	return result.Prompts, nil
}

// GetPrompt fetches/renders a prompt by name with arguments from the HTTP JSON-RPC server.
func (c *HTTPClient) GetPrompt(ctx context.Context, name string, arguments map[string]any, extraHeaders map[string]string) (*GetPromptResult, string, error) {
	params := map[string]any{
		"name": name,
	}
	if len(arguments) > 0 {
		params["arguments"] = arguments
	}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return nil, "", err
	}

	resp, err := c.sendRequest(ctx, "prompts/get", paramsBytes, extraHeaders)
	if err != nil {
		return nil, "", err
	}
	if resp.Error != nil {
		return nil, "", fmt.Errorf("prompts/get error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	var result GetPromptResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal prompts/get result: %w", err)
	}
	result.RawJSON = resp.Result
	return &result, "", nil
}

// Close is a no-op for HTTPClient.
func (c *HTTPClient) Close() error {
	return nil
}
