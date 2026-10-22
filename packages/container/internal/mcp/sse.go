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
	"errors"
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
	url      string
	writeURL string
	// httpClient has no overall timeout (http.Client.Timeout covers reading the whole body, so it
	// would cut the event stream, and every response pending on it): Connect bounds the stream's
	// response headers and sendRequest each exchange, by the caller's deadline or else timeout.
	httpClient   *http.Client
	timeout      time.Duration // sseRequestTimeout when the client was made (tests change the variable)
	streamEnded  bool          // the event stream is gone: no response can arrive any more
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

// sseRequestTimeout bounds each exchange with the server (a POST and the wait for its response on
// the stream) when the caller's ctx has no deadline, and the stream's response headers. It is a
// variable for tests.
var sseRequestTimeout = 30 * time.Second

// NewSSEClient initializes a new SSEClient.
// If tlsConfig is nil, uses system certificate pool with certificate validation enabled.
func NewSSEClient(urlStr string, allowPrivateIPs bool, headers map[string]string, tlsConfig *tls.Config) *SSEClient {
	client := &SSEClient{
		url:          urlStr,
		httpClient:   security.NewSSRFProtectedClient(0, allowPrivateIPs),
		pending:      make(map[string]chan *Response),
		endpointChan: make(chan string, 1),
		headers:      headers,
		timeout:      sseRequestTimeout,
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

	// A redirect must not take the client's headers somewhere sameOriginEndpoint would refuse.
	client.httpClient.CheckRedirect = checkSameOriginRedirect

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

	// c.ctx manages the stream's whole life, so it has no deadline. The response headers are
	// bounded by the caller's deadline, or the client's timeout without one: when that runs out
	// first, c.ctx is cancelled, which aborts Do. If it runs out just as Do returns, the stream
	// is already cancelled, and Connect fails rather than return a client whose stream is dead.
	headerCtx, headerCancel := c.bounded(ctx)
	defer headerCancel()
	stop := context.AfterFunc(headerCtx, c.cancel)

	resp, err := c.httpClient.Do(req)
	if !stop() && err == nil { // the cancel has started: this stream is about to be cut
		_ = resp.Body.Close()
		err = fmt.Errorf("no SSE response headers: %w", headerCtx.Err())
	}
	if err == nil && c.ctx.Err() != nil {
		_ = resp.Body.Close()
		err = fmt.Errorf("no SSE response headers: %w", headerCtx.Err())
	}
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
	// The stream's URL after any redirect (an http to https upgrade): the write endpoint is
	// checked and resolved against where the stream actually is.
	sseURL := resp.Request.URL
	u := *sseURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/message"
	u.RawQuery = ""
	defaultWriteURL := u.String()

	select {
	case ep := <-c.endpointChan:
		w, ok := sameOriginEndpoint(sseURL, ep)
		if !ok {
			// Fail closed and say why: a fallback URL would drop the server's session id and
			// surface only as an unexplained 404 on the handshake.
			_ = c.Close()
			return fmt.Errorf("MCP server announced the endpoint %q, which is not on %s://%s; refusing to send requests there",
				ep, sseURL.Scheme, sseURL.Host)
		}
		c.writeURL = w
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

// sameOriginEndpoint resolves the endpoint the server announced against the SSE URL and returns
// it only if it keeps the SSE URL's origin (ok false otherwise). The server chooses the endpoint,
// and every POST to it carries the client's headers: a cross-host one ("https://evil",
// "//evil") would send them elsewhere, an http one in cleartext.
func sameOriginEndpoint(sseURL *url.URL, endpoint string) (string, bool) {
	epURL, err := url.Parse(endpoint)
	if err != nil {
		return "", false
	}
	resolved := sseURL.ResolveReference(epURL)
	if !sameOrigin(resolved, sseURL) {
		return "", false
	}
	return resolved.String(), true
}

// sameOrigin reports whether a and b have the same scheme, host and port, a missing port
// counting as the scheme's default.
func sameOrigin(a, b *url.URL) bool {
	return strings.EqualFold(a.Scheme, b.Scheme) &&
		strings.EqualFold(a.Hostname(), b.Hostname()) &&
		portOrDefault(a) == portOrDefault(b)
}

func portOrDefault(u *url.URL) string {
	if p := u.Port(); p != "" {
		return p
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
		return "443"
	case "http":
		return "80"
	}
	return ""
}

// checkSameOriginRedirect refuses a redirect that leaves the first request's origin, except an
// upgrade from http to https on the same host, and stops after 10 like the default policy.
func checkSameOriginRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 10 {
		return errors.New("stopped after 10 redirects")
	}
	first := via[0].URL
	upgrade := strings.EqualFold(first.Scheme, "http") && strings.EqualFold(req.URL.Scheme, "https") &&
		strings.EqualFold(first.Hostname(), req.URL.Hostname()) &&
		(req.URL.Port() == first.Port() || (portOrDefault(first) == "80" && portOrDefault(req.URL) == "443")) // same service, now encrypted
	if !upgrade && !sameOrigin(req.URL, first) {
		return fmt.Errorf("refusing redirect to another origin: %s://%s", req.URL.Scheme, req.URL.Host)
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

	notifCtx, cancel := c.bounded(ctx)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(notifCtx, "POST", c.writeURL, bytes.NewReader(notifBytes))
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

// bounded returns ctx unchanged when it has a deadline, else ctx limited to the client's timeout:
// the caller's deadline bounds a POST and the wait for its response, and the client has no
// overall timeout of its own (it would cut the stream).
func (c *SSEClient) bounded(ctx context.Context) (context.Context, context.CancelFunc) {
	if _, hasDeadline := ctx.Deadline(); hasDeadline {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, c.timeout)
}

func (c *SSEClient) sendRequest(ctx context.Context, method string, params json.RawMessage, extraHeaders map[string]string) (*Response, error) {
	ctx, cancel := c.bounded(ctx)
	defer cancel()

	c.pendingMu.Lock()
	if c.isClosed {
		c.pendingMu.Unlock()
		return nil, io.ErrClosedPipe
	}
	if c.streamEnded {
		c.pendingMu.Unlock()
		return nil, fmt.Errorf("the MCP server closed the SSE stream, so no response can arrive (it is not reopened): %w", io.ErrClosedPipe)
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
		return nil, fmt.Errorf("no response to %s: %w", method, ctx.Err())
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
	c.streamEnded = true // later requests fail at once instead of waiting for a response
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
	result.RawJSON = resp.Result
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
	result.RawJSON = resp.Result
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
	result.RawJSON = resp.Result
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

	// Each client has its own transport (connection pool): release its idle connections now.
	c.httpClient.CloseIdleConnections()
	return nil
}
