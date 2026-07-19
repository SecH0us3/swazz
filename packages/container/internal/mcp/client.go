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
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"swazz-engine/internal/security"
)

const (
	mcpProtocolVersion = "2024-11-05"
)

// Request is the JSON-RPC 2.0 request wrapper.
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
	ID      any             `json:"id"`
}

// Response is the JSON-RPC 2.0 response wrapper.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
	ID      any             `json:"id"`
}

// RPCError is a standard JSON-RPC 2.0 error object.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func idToKey(id any) string {
	if id == nil {
		return ""
	}
	switch v := id.(type) {
	case string:
		return "s:" + v
	case int:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case int64:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case uint64:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case int32:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case uint32:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	case float64:
		return "f:" + strconv.FormatFloat(v, 'f', -1, 64)
	case float32:
		return "f:" + strconv.FormatFloat(float64(v), 'f', -1, 64)
	default:
		return fmt.Sprintf("v:%v", v)
	}
}

// StdioClient implements the Client interface using OS standard I/O channels to communicate with a subprocess.
type StdioClient struct {
	command     string
	args        []string
	cmd         *exec.Cmd
	stdin       io.WriteCloser
	stdout      io.ReadCloser
	stderrBuf   bytes.Buffer
	stderrMu    sync.Mutex
	stdinMu     sync.Mutex
	pendingMu   sync.Mutex
	pending     map[string]chan *Response
	nextID      uint64
	ctx         context.Context
	cancel      context.CancelFunc
	processDone chan struct{}
	exitErr     error
	errOnce     sync.Once
	isClosed    bool
}

// NewStdioClient initializes a new StdioClient.
func NewStdioClient(command string, args []string) *StdioClient {
	return &StdioClient{
		command:     command,
		args:        args,
		pending:     make(map[string]chan *Response),
		processDone: make(chan struct{}),
	}
}

// Connect starts the subprocess and prepares communication channels.
func (c *StdioClient) Connect(ctx context.Context) error {
	if c.command == "" {
		return fmt.Errorf("command cannot be empty")
	}
	if len(c.args) == 0 {
		return fmt.Errorf("args cannot be empty")
	}
	// Validate command path to prevent command injection
	absPath, err := filepath.Abs(c.command)
	if err != nil {
		return fmt.Errorf("invalid command path: %w", err)
	}
	if !filepath.IsAbs(absPath) {
		return fmt.Errorf("command must be an absolute path")
	}
	// Prevent directory traversal
	if filepath.Base(absPath) != filepath.Base(c.command) {
		return fmt.Errorf("invalid command path: possible directory traversal")
	}
	// Check for suspicious characters in individual args
	for _, arg := range c.args {
		if strings.Contains(arg, ";") || strings.Contains(arg, "&") || strings.Contains(arg, "|") ||
			strings.Contains(arg, "`") || strings.Contains(arg, "$") ||
			strings.Contains(arg, "'") || strings.Contains(arg, "\"") ||
			strings.Contains(arg, "<") || strings.Contains(arg, ">") {
			return fmt.Errorf("args contain suspicious characters")
		}
	}
	c.ctx, c.cancel = context.WithCancel(ctx)
	c.cmd = exec.CommandContext(c.ctx, c.command, c.args...)

	stdin, err := c.cmd.StdinPipe()
	if err != nil {
		c.cancel()
		return fmt.Errorf("failed to open stdin pipe: %w", err)
	}
	c.stdin = stdin

	stdout, err := c.cmd.StdoutPipe()
	if err != nil {
		c.cancel()
		return fmt.Errorf("failed to open stdout pipe: %w", err)
	}
	c.stdout = stdout

	stderr, err := c.cmd.StderrPipe()
	if err != nil {
		c.cancel()
		return fmt.Errorf("failed to open stderr pipe: %w", err)
	}

	if err := c.cmd.Start(); err != nil {
		c.cancel()
		return fmt.Errorf("failed to start process: %w", err)
	}

	go c.readStdoutLoop()
	go c.readStderrLoop(stderr)
	go c.waitProcess()

	// Perform initialize handshake
	if err := c.initializeHandshake(ctx); err != nil {
		_ = c.Close()
		return fmt.Errorf("handshake failed: %w", err)
	}

	return nil
}

func (c *StdioClient) initializeHandshake(ctx context.Context) error {
	initParams := map[string]any{
		"protocolVersion": mcpProtocolVersion,
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

	resp, err := c.sendRequest(ctx, "initialize", paramsBytes)
	if err != nil {
		return err
	}
	if resp.Error != nil {
		return fmt.Errorf("initialize error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	// Send notifications/initialized notification
	notif := Request{
		JSONRPC: "2.0",
		Method:  "notifications/initialized",
	}
	notifBytes, err := json.Marshal(notif)
	if err != nil {
		return err
	}
	notifBytes = append(notifBytes, '\n')

	c.pendingMu.Lock()
	closed := c.isClosed
	c.pendingMu.Unlock()
	if closed {
		return io.ErrClosedPipe
	}
	c.stdinMu.Lock()
	defer c.stdinMu.Unlock()
	_, err = c.stdin.Write(notifBytes)
	return err
}

func (c *StdioClient) sendRequest(ctx context.Context, method string, params json.RawMessage) (*Response, error) {
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
	data = append(data, '\n')

	c.pendingMu.Lock()
	closed := c.isClosed
	c.pendingMu.Unlock()
	if closed {
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return nil, io.ErrClosedPipe
	}

	c.stdinMu.Lock()
	_, err = c.stdin.Write(data)
	c.stdinMu.Unlock()

	if err != nil {
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return nil, err
	}

	select {
	case resp, ok := <-ch:
		if !ok {
			return nil, fmt.Errorf("channel closed, process likely terminated: %w", c.getExitError())
		}
		return resp, nil
	case <-ctx.Done():
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return nil, ctx.Err()
	case <-c.processDone:
		return nil, fmt.Errorf("process terminated: %w", c.getExitError())
	}
}

func (c *StdioClient) getExitError() error {
	c.stderrMu.Lock()
	defer c.stderrMu.Unlock()
	if c.exitErr != nil {
		stderrContent := c.stderrBuf.String()
		if stderrContent != "" {
			return fmt.Errorf("%w (stderr: %s)", c.exitErr, stderrContent)
		}
		return c.exitErr
	}
	return fmt.Errorf("unknown exit error")
}

func (c *StdioClient) readStdoutLoop() {
	decoder := json.NewDecoder(c.stdout)
	for {
		var resp Response
		if err := decoder.Decode(&resp); err != nil {
			// EOF or broken pipe: process exited
			break
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

func (c *StdioClient) readStderrLoop(stderr io.Reader) {
	buf := make([]byte, 1024)
	for {
		n, err := stderr.Read(buf)
		if n > 0 {
			c.stderrMu.Lock()
			c.stderrBuf.Write(buf[:n])
			c.stderrMu.Unlock()
		}
		if err != nil {
			break
		}
	}
}

func (c *StdioClient) waitProcess() {
	err := c.cmd.Wait()
	c.errOnce.Do(func() {
		c.exitErr = err
		close(c.processDone)
	})

	c.pendingMu.Lock()
	for k, ch := range c.pending {
		delete(c.pending, k)
		close(ch)
	}
	c.pendingMu.Unlock()
}

// ListTools retrieves the list of tools from the subprocess.
func (c *StdioClient) ListTools(ctx context.Context) ([]Tool, error) {
	resp, err := c.sendRequest(ctx, "tools/list", nil)
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

// CallTool invokes a tool on the subprocess.
func (c *StdioClient) CallTool(ctx context.Context, name string, arguments map[string]any) (*CallToolResult, string, error) {
	params := map[string]any{
		"name":      name,
		"arguments": arguments,
	}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		c.stderrMu.Lock()
		stderrLogs := c.stderrBuf.String()
		c.stderrMu.Unlock()
		return nil, stderrLogs, err
	}

	resp, err := c.sendRequest(ctx, "tools/call", paramsBytes)
	c.stderrMu.Lock()
	stderrLogs := c.stderrBuf.String()
	c.stderrMu.Unlock()

	if err != nil {
		return nil, stderrLogs, err
	}
	if resp.Error != nil {
		return nil, stderrLogs, fmt.Errorf("tools/call error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	var result CallToolResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, stderrLogs, fmt.Errorf("failed to unmarshal tools/call result: %w", err)
	}
	return &result, stderrLogs, nil
}

// Close terminates the subprocess.
func (c *StdioClient) Close() error {
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

	c.stdinMu.Lock()
	if c.stdin != nil {
		_ = c.stdin.Close()
	}
	c.stdinMu.Unlock()

	// Wait for process to finish with timeout to prevent deadlock
	select {
	case <-c.processDone:
		return nil
	case <-time.After(10 * time.Second):
		return fmt.Errorf("timeout waiting for process termination")
	}
}

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

	resp, err := c.sendRequest(ctx, "initialize", paramsBytes)
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

func (c *SSEClient) sendRequest(ctx context.Context, method string, params json.RawMessage) (*Response, error) {
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
	resp, err := c.sendRequest(ctx, "tools/list", nil)
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
func (c *SSEClient) CallTool(ctx context.Context, name string, arguments map[string]any) (*CallToolResult, string, error) {
	params := map[string]any{
		"name":      name,
		"arguments": arguments,
	}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return nil, "", err
	}

	resp, err := c.sendRequest(ctx, "tools/call", paramsBytes)
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

func (c *HTTPClient) sendRequest(ctx context.Context, method string, params json.RawMessage) (*Response, error) {
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
	req.Header.Set("Accept", "application/json")
	for k, v := range c.headers {
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

	resp, err := c.sendRequest(ctx, "initialize", paramsBytes)
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
	resp, err := c.sendRequest(ctx, "tools/list", nil)
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
func (c *HTTPClient) CallTool(ctx context.Context, name string, arguments map[string]any) (*CallToolResult, string, error) {
	params := map[string]any{
		"name":      name,
		"arguments": arguments,
	}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		return nil, "", err
	}

	resp, err := c.sendRequest(ctx, "tools/call", paramsBytes)
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

// Close is a no-op for HTTPClient.
func (c *HTTPClient) Close() error {
	return nil
}
