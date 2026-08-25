// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

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
	// #nosec G204 -- The command and args are already sanitized above
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

	resp, err := c.sendRequest(ctx, "initialize", paramsBytes, nil)
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

// extraHeaders is accepted for interface symmetry with the HTTP/SSE transports
// and ignored: a stdio subprocess has no request headers. CallTool already
// refuses a non-nil identity override before reaching here.
func (c *StdioClient) sendRequest(ctx context.Context, method string, params json.RawMessage, _ map[string]string) (*Response, error) {
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

// CallTool invokes a tool on the subprocess.
func (c *StdioClient) CallTool(ctx context.Context, name string, arguments map[string]any, extraHeaders map[string]string) (*CallToolResult, string, error) {
	// A stdio server is one spawned process with one identity; there are no
	// per-call headers to vary. Refuse rather than silently ignore, so a BOLA
	// run against a stdio target does not look like it tested a second identity.
	if len(extraHeaders) > 0 {
		return nil, "", fmt.Errorf("stdio MCP transport cannot switch identity per call")
	}
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

	resp, err := c.sendRequest(ctx, "tools/call", paramsBytes, nil)
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

// ListResources retrieves the list of resources from the subprocess.
func (c *StdioClient) ListResources(ctx context.Context) ([]Resource, error) {
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

// ReadResource reads a resource by URI from the subprocess.
func (c *StdioClient) ReadResource(ctx context.Context, uri string, extraHeaders map[string]string) (*ReadResourceResult, string, error) {
	if len(extraHeaders) > 0 {
		return nil, "", fmt.Errorf("stdio MCP transport cannot switch identity per call")
	}
	params := map[string]any{"uri": uri}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		c.stderrMu.Lock()
		stderrLogs := c.stderrBuf.String()
		c.stderrMu.Unlock()
		return nil, stderrLogs, err
	}

	resp, err := c.sendRequest(ctx, "resources/read", paramsBytes, nil)
	c.stderrMu.Lock()
	stderrLogs := c.stderrBuf.String()
	c.stderrMu.Unlock()

	if err != nil {
		return nil, stderrLogs, err
	}
	if resp.Error != nil {
		return nil, stderrLogs, fmt.Errorf("resources/read error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	var result ReadResourceResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, stderrLogs, fmt.Errorf("failed to unmarshal resources/read result: %w", err)
	}
	return &result, stderrLogs, nil
}

// ListPrompts retrieves the list of prompts from the subprocess.
func (c *StdioClient) ListPrompts(ctx context.Context) ([]Prompt, error) {
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

// GetPrompt fetches/renders a prompt by name with arguments from the subprocess.
func (c *StdioClient) GetPrompt(ctx context.Context, name string, arguments map[string]any, extraHeaders map[string]string) (*GetPromptResult, string, error) {
	if len(extraHeaders) > 0 {
		return nil, "", fmt.Errorf("stdio MCP transport cannot switch identity per call")
	}
	params := map[string]any{
		"name": name,
	}
	if len(arguments) > 0 {
		params["arguments"] = arguments
	}
	paramsBytes, err := json.Marshal(params)
	if err != nil {
		c.stderrMu.Lock()
		stderrLogs := c.stderrBuf.String()
		c.stderrMu.Unlock()
		return nil, stderrLogs, err
	}

	resp, err := c.sendRequest(ctx, "prompts/get", paramsBytes, nil)
	c.stderrMu.Lock()
	stderrLogs := c.stderrBuf.String()
	c.stderrMu.Unlock()

	if err != nil {
		return nil, stderrLogs, err
	}
	if resp.Error != nil {
		return nil, stderrLogs, fmt.Errorf("prompts/get error: %s (code %d)", resp.Error.Message, resp.Error.Code)
	}

	var result GetPromptResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		return nil, stderrLogs, fmt.Errorf("failed to unmarshal prompts/get result: %w", err)
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
