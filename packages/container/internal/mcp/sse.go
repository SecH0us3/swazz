// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package mcp

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"swazz-engine/internal/security"
)

// SSEEvent represents a standard server-sent event.
type SSEEvent struct {
	Event string
	Data  string
}

// SSEClient implements the Client interface using SSE and HTTP POST to communicate with an MCP server.
type SSEClient struct {
	url          string
	writeURL     string
	httpClient   *http.Client
	pendingMu    sync.Mutex
	pending      map[string]chan *Response
	nextID       uint64
	ctx          context.Context
	cancel       context.CancelFunc
	endpointChan chan string
	endpointMu   sync.Mutex
	sseResponse  *http.Response
	isClosed     bool
	headers      map[string]string
}

// NewSSEClient initializes a new SSEClient.
// If tlsConfig is nil, uses system certificate pool with certificate validation enabled.
func NewSSEClient(urlStr string, allowPrivateIPs bool, headers map[string]string, tlsConfig *tls.Config) *SSEClient {
	client := &SSEClient{
		url:          urlStr,
		httpClient:   security.NewSSRFProtectedClient(30*time.Second, allowPrivateIPs),
		pending:      make(map[string]chan *Response),
		endpointChan: make(chan string, 1),
		headers:      headers,
	}

	// Always enable certificate validation by default
	if transport, ok := client.httpClient.Transport.(*http.Transport); ok {
		if transport.TLSClientConfig == nil {
			transport.TLSClientConfig = &tls.Config{
				InsecureSkipVerify: false,
				MinVersion:         tls.VersionTLS12,
			}
		}
		if tlsConfig != nil {
			transport.TLSClientConfig = tlsConfig.Clone()
			// Ensure InsecureSkipVerify is false unless explicitly set in tlsConfig
			if !tlsConfig.InsecureSkipVerify {
				transport.TLSClientConfig.InsecureSkipVerify = false
			}
		}
	}

	return client
}

// Connect establishes the SSE GET connection and resolves the write endpoint.
func (c *SSEClient) Connect(ctx context.Context) error {
	c.ctx, c.cancel = context.WithCancel(context.Background())

	req, err := http.NewRequestWithContext(c.ctx, "GET", c.url, nil)
	if err != nil {
		c.cancel()
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Connection", "keep-alive")
	for k, v := range c.headers {
		req.Header.Set(k, v)
	}

	// Enforce the connection timeout context during the dial/handshake phase.
	// Since c.ctx does not have a timeout (it manages client lifecycle), we monitor
	// the passed-in timeout context ctx and cancel c.ctx if it expires.
	connectDone := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			c.cancel() // Aborts Do(req)
		case <-connectDone:
		}
	}()

	resp, err := c.httpClient.Do(req)
	close(connectDone)
	if err != nil {
		c.cancel()
		return err
	}

	if resp.StatusCode != http.StatusOK {
		_ = resp.Body.Close()
		c.cancel()
		return fmt.Errorf("SSE connection failed with status %d", resp.StatusCode)
	}
	c.sseResponse = resp

	go c.readSSELoop(resp.Body)

	// Determine default write URL using net/url to avoid string concatenation
	u, err := url.Parse(c.url)
	if err != nil {
		_ = c.Close()
		return fmt.Errorf("invalid URL: %w", err)
	}
	u.Path = strings.TrimSuffix(u.Path, "/") + "/message"
	defaultWriteURL := u.String()

	select {
	case ep := <-c.endpointChan:
		epURL, err := url.Parse(ep)
		if err == nil {
			if epURL.IsAbs() {
				// Security: only allow redirects to the same host as the original SSE URL
				// to prevent a compromised server from redirecting to internal metadata services.
				baseURL, baseErr := url.Parse(c.url)
				if baseErr == nil && epURL.Host == baseURL.Host {
					c.writeURL = ep
				} else {
					// Reject cross-host redirect; fall back to derived default
					c.writeURL = defaultWriteURL
				}
			} else {
				base, err := url.Parse(c.url)
				if err == nil {
					c.writeURL = base.ResolveReference(epURL).String()
				} else {
					c.writeURL = ep
				}
			}
		} else {
			c.writeURL = defaultWriteURL
		}
	case <-ctx.Done():
		_ = c.Close()
		return ctx.Err()
	case <-time.After(500 * time.Millisecond):
		c.writeURL = defaultWriteURL
	}

	// Perform initialize handshake
	if err := c.initializeHandshake(ctx); err != nil {
		_ = c.Close()
		return fmt.Errorf("handshake failed: %w", err)
	}

	return nil
}

func (c *SSEClient) initializeHandshake(ctx context.Context) error {
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

	notif := Request{
		JSONRPC: "2.0",
		Method:  "notifications/initialized",
	}
	notifBytes, err := json.Marshal(notif)
	if err != nil {
		return err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.writeURL, bytes.NewReader(notifBytes))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	for k, v := range c.headers {
		httpReq.Header.Set(k, v)
	}

	postResp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return err
	}
	_ = postResp.Body.Close()
	return nil
}

func (c *SSEClient) sendRequest(ctx context.Context, method string, params json.RawMessage, extraHeaders map[string]string) (*Response, error) {
	c.pendingMu.Lock()
	if c.isClosed {
		c.pendingMu.Unlock()
		return nil, io.ErrClosedPipe
	}
	c.nextID++
	id := c.nextID
	ch := make(chan *Response, 1)
	key := idToKey(id)
	c.pending[key] = ch
	c.pendingMu.Unlock()

	req := Request{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      id,
	}

	data, err := json.Marshal(req)
	if err != nil {
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.writeURL, bytes.NewReader(data))
	if err != nil {
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	for k, v := range c.headers {
		httpReq.Header.Set(k, v)
	}
	// Per-call identity overrides win over the client's base headers.
	for k, v := range extraHeaders {
		httpReq.Header.Set(k, v)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return nil, fmt.Errorf("POST request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted && resp.StatusCode != http.StatusNoContent {
		bodyBytes, _ := io.ReadAll(resp.Body)
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return nil, fmt.Errorf("POST request to %s failed with status %d: %s (req body: %s)", c.writeURL, resp.StatusCode, string(bodyBytes), string(data))
	}

	select {
	case response, ok := <-ch:
		if !ok {
			return nil, fmt.Errorf("SSE connection closed while waiting for response")
		}
		return response, nil
	case <-ctx.Done():
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return nil, ctx.Err()
	}
}

func (c *SSEClient) readSSELoop(body io.ReadCloser) {
	defer body.Close()
	scanner := bufio.NewScanner(body)
	// Support token sizes up to 1MB to prevent DoS attacks
	const maxTokenSize = 1 * 1024 * 1024
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, maxTokenSize)

	var currentEvent SSEEvent

	for scanner.Scan() {
		line := scanner.Text()

		if line == "" {
			if currentEvent.Event != "" || currentEvent.Data != "" {
				c.handleSSEEvent(currentEvent)
			}
			currentEvent = SSEEvent{}
			continue
		}

		if strings.HasPrefix(line, "event:") {
			currentEvent.Event = strings.TrimSpace(line[6:])
		} else if strings.HasPrefix(line, "data:") {
			dataVal := strings.TrimSpace(line[5:])
			if currentEvent.Data == "" {
				currentEvent.Data = dataVal
			} else {
				currentEvent.Data += "\n" + dataVal
			}
		}
	}

	if err := scanner.Err(); err != nil {
		log.Printf("SSE scanner error: %v", err)
	}

	c.pendingMu.Lock()
	for k, ch := range c.pending {
		delete(c.pending, k)
		close(ch)
	}
	c.pendingMu.Unlock()
}

func (c *SSEClient) handleSSEEvent(event SSEEvent) {
	if event.Event == "endpoint" {
		c.endpointMu.Lock()
		defer c.endpointMu.Unlock()
		select {
		case c.endpointChan <- event.Data:
		default:
		}
		return
	}

	if event.Event == "message" {
		var resp Response
		if err := json.Unmarshal([]byte(event.Data), &resp); err != nil {
			return
		}

		key := idToKey(resp.ID)
		c.pendingMu.Lock()
		ch, ok := c.pending[key]
		if ok {
			delete(c.pending, key)
		}
		c.pendingMu.Unlock()

		if ok {
			ch <- &resp
		}
	}
}

// ListTools retrieves the list of tools from the SSE-connected server.
func (c *SSEClient) ListTools(ctx context.Context) ([]Tool, error) {
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

// CallTool invokes a tool on the SSE-connected server.
func (c *SSEClient) CallTool(ctx context.Context, name string, arguments map[string]any, extraHeaders map[string]string) (*CallToolResult, string, error) {
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
	return &result, "", nil
}

// ListResources retrieves the list of resources from the SSE-connected server.
func (c *SSEClient) ListResources(ctx context.Context) ([]Resource, error) {
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

// ReadResource reads a resource by URI from the SSE-connected server.
func (c *SSEClient) ReadResource(ctx context.Context, uri string, extraHeaders map[string]string) (*ReadResourceResult, string, error) {
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
	return &result, "", nil
}

// ListPrompts retrieves the list of prompts from the SSE-connected server.
func (c *SSEClient) ListPrompts(ctx context.Context) ([]Prompt, error) {
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

// GetPrompt fetches/renders a prompt by name with arguments from the SSE-connected server.
func (c *SSEClient) GetPrompt(ctx context.Context, name string, arguments map[string]any, extraHeaders map[string]string) (*GetPromptResult, string, error) {
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
	return &result, "", nil
}

// Close terminates the SSE GET connection.
func (c *SSEClient) Close() error {
	c.pendingMu.Lock()
	if c.isClosed {
		c.pendingMu.Unlock()
		return nil
	}
	c.isClosed = true
	c.pendingMu.Unlock()

	if c.cancel != nil {
		c.cancel()
	}

	c.pendingMu.Lock()
	for k, ch := range c.pending {
		delete(c.pending, k)
		close(ch)
	}
	c.pendingMu.Unlock()

	return nil
}
