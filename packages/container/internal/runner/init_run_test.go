// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"errors"
	"testing"
	"time"

	"swazz-engine/internal/mcp"
	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockDiscoveryMCPClient struct {
	tools     []mcp.Tool
	resources []mcp.Resource
	prompts   []mcp.Prompt
}

func (m *mockDiscoveryMCPClient) Connect(ctx context.Context) error { return nil }
func (m *mockDiscoveryMCPClient) Close() error                      { return nil }
func (m *mockDiscoveryMCPClient) ListTools(ctx context.Context) ([]mcp.Tool, error) {
	return m.tools, nil
}
func (m *mockDiscoveryMCPClient) CallTool(ctx context.Context, name string, args map[string]any, extraHeaders map[string]string) (*mcp.CallToolResult, string, error) {
	return &mcp.CallToolResult{}, "", nil
}
func (m *mockDiscoveryMCPClient) ListResources(ctx context.Context) ([]mcp.Resource, error) {
	return m.resources, nil
}
func (m *mockDiscoveryMCPClient) ReadResource(ctx context.Context, uri string, extraHeaders map[string]string) (*mcp.ReadResourceResult, string, error) {
	return &mcp.ReadResourceResult{}, "", nil
}
func (m *mockDiscoveryMCPClient) ListPrompts(ctx context.Context) ([]mcp.Prompt, error) {
	return m.prompts, nil
}
func (m *mockDiscoveryMCPClient) GetPrompt(ctx context.Context, name string, args map[string]any, extraHeaders map[string]string) (*mcp.GetPromptResult, string, error) {
	return &mcp.GetPromptResult{}, "", nil
}

func TestMCPDiscovery_AllEnabled(t *testing.T) {
	mock := &mockDiscoveryMCPClient{
		tools: []mcp.Tool{
			{Name: "calculator", InputSchema: swagger.SchemaProperty{Type: "object"}},
		},
		resources: []mcp.Resource{
			{URI: "file:///config.json", Name: "Config"},
		},
		prompts: []mcp.Prompt{
			{
				Name: "review",
				Arguments: []mcp.PromptArgument{
					{Name: "code", Required: true},
					{Name: "lang", Required: false},
				},
			},
		},
	}

	cfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{Type: "stdio"},
		Settings:  swagger.Settings{
			// All fuzzing enabled by default
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	r.mcpClient = mock

	ctx, err := r.initRun(context.Background())
	require.NoError(t, err)
	defer r.finaliseRun()
	assert.NotNil(t, ctx)

	endpoints := r.config.Endpoints
	// Should have:
	// 1. Tool: mcp://tool/calculator
	// 2. Resource: mcp://resource/file:///config.json
	// 3. Prompt: mcp://prompt/review
	// plus method probes if MCPMethodFuzzingEnabled is true
	var foundTool, foundResource, foundPrompt bool
	for _, ep := range endpoints {
		if ep.Path == "mcp://tool/calculator" && ep.Method == "CALL" {
			foundTool = true
		}
		if ep.Path == "mcp://resource/file:///config.json" && ep.Method == "READ" {
			foundResource = true
			assert.NotNil(t, ep.Schema.Properties["uri"])
			assert.Equal(t, "string", ep.Schema.Properties["uri"].Type)
		}
		if ep.Path == "mcp://prompt/review" && ep.Method == "PROMPT" {
			foundPrompt = true
			assert.Equal(t, "object", ep.Schema.Type)
			assert.NotNil(t, ep.Schema.Properties["code"])
			assert.NotNil(t, ep.Schema.Properties["lang"])
			assert.Contains(t, ep.Schema.Required, "code")
			assert.NotContains(t, ep.Schema.Required, "lang")
		}
	}

	assert.True(t, foundTool, "mcp tool should be registered")
	assert.True(t, foundResource, "mcp resource should be registered")
	assert.True(t, foundPrompt, "mcp prompt should be registered")
}

func TestMCPDiscovery_SelectiveDisabling(t *testing.T) {
	mock := &mockDiscoveryMCPClient{
		tools: []mcp.Tool{
			{Name: "calculator", InputSchema: swagger.SchemaProperty{Type: "object"}},
		},
		resources: []mcp.Resource{
			{URI: "file:///config.json", Name: "Config"},
		},
		prompts: []mcp.Prompt{
			{
				Name: "review",
				Arguments: []mcp.PromptArgument{
					{Name: "code", Required: true},
				},
			},
		},
	}

	f := false
	mcpMethodFuzzFalse := false
	cfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{Type: "stdio"},
		Settings: swagger.Settings{
			MCPFuzzTools:           &f,
			MCPFuzzResources:       &f,
			EnableMCPMethodFuzzing: &mcpMethodFuzzFalse,
		},
	}

	r := New(cfg, nil)
	defer r.Close()
	r.mcpClient = mock

	ctx, err := r.initRun(context.Background())
	require.NoError(t, err)
	defer r.finaliseRun()
	assert.NotNil(t, ctx)

	endpoints := r.config.Endpoints
	var foundTool, foundResource, foundPrompt bool
	for _, ep := range endpoints {
		if ep.Path == "mcp://tool/calculator" {
			foundTool = true
		}
		if ep.Path == "mcp://resource/file:///config.json" {
			foundResource = true
		}
		if ep.Path == "mcp://prompt/review" {
			foundPrompt = true
		}
	}

	assert.False(t, foundTool, "tool fuzzing is disabled, should not register calculator")
	assert.False(t, foundResource, "resource fuzzing is disabled, should not register config.json")
	assert.True(t, foundPrompt, "prompt fuzzing is enabled, should register review")
}

// failingMCPClient fails to connect, or (listErr) connects and fails to list its tools.
type failingMCPClient struct {
	mockDiscoveryMCPClient
	connectErr error
	listErr    error
	closed     bool
}

func (m *failingMCPClient) Connect(ctx context.Context) error { return m.connectErr }
func (m *failingMCPClient) Close() error                      { m.closed = true; return nil }
func (m *failingMCPClient) ListTools(ctx context.Context) ([]mcp.Tool, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	return m.tools, nil
}

// userLogs collects the runner_log events broadcast until the stream is quiet.
func userLogs(t *testing.T, sub chan Event) []map[string]interface{} {
	t.Helper()
	var out []map[string]interface{}
	for {
		select {
		case ev, ok := <-sub:
			if !ok {
				return out
			}
			if ev.Type == "runner_log" {
				out = append(out, ev.Data.(map[string]interface{}))
			}
		case <-time.After(300 * time.Millisecond):
			return out
		}
	}
}

func logsAt(logs []map[string]interface{}, level string) []string {
	var out []string
	for _, l := range logs {
		if l["level"] == level {
			out = append(out, l["message"].(string))
		}
	}
	return out
}

// An MCP server left in the project settings that rejects the runner must not stop the rest of
// the scan; the user is told why the MCP part was skipped and what to change.
func TestInitRun_UnreachableMCPServerSkipsOnlyTheMCPPart(t *testing.T) {
	for name, client := range map[string]*failingMCPClient{
		"connect fails":    {connectErr: errors.New("SSE connection failed with status 401")},
		"list tools fails": {listErr: errors.New("SSE connection failed with status 401")},
	} {
		t.Run(name, func(t *testing.T) {
			cfg := &swagger.Config{
				MCPServer: &swagger.MCPServerConfig{Type: "sse", URL: "https://mcp.example.com/sse?token=secret"},
				Endpoints: []swagger.EndpointConfig{
					{Method: "GET", Path: "/users"},
					{Method: "CALL", Path: "mcp://tool/configured"},
				},
			}
			r := New(cfg, nil)
			defer r.Close()
			r.mcpClient = client
			sub := r.Subscribe()

			_, err := r.initRun(context.Background())
			require.NoError(t, err)
			defer r.finaliseRun()

			assert.Nil(t, r.mcpClient)
			assert.True(t, client.closed)
			assert.Equal(t, []swagger.EndpointConfig{{Method: "GET", Path: "/users"}}, r.config.Endpoints)

			logs := userLogs(t, sub)
			warns := logsAt(logs, "warn")
			require.Len(t, warns, 1)
			assert.Contains(t, warns[0], "status 401")
			assert.Contains(t, warns[0], "everything else is scanned as usual")
			assert.Contains(t, warns[0], "Global Headers")
			assert.Contains(t, logsAt(logs, "info"), "Scan targets: 1 API endpoint(s)")
			for _, l := range logs {
				assert.NotContains(t, l["message"], "secret", "the MCP URL may carry a token")
			}
		})
	}
}

// With nothing but the MCP server to scan, the scan fails, and says why in the user's log.
func TestInitRun_UnreachableMCPServerFailsAnMCPOnlyScan(t *testing.T) {
	cfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{Type: "sse", URL: "https://mcp.example.com/sse"},
	}
	r := New(cfg, nil)
	defer r.Close()
	r.mcpClient = &failingMCPClient{connectErr: errors.New("SSE connection failed with status 401")}
	sub := r.Subscribe()

	_, err := r.initRun(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "could not connect to the MCP server")
	assert.False(t, r.lifecycle.isRunning.Load())

	errs := logsAt(userLogs(t, sub), "error")
	require.Len(t, errs, 1)
	assert.Contains(t, errs[0], "only target of this scan")
}

func TestInitRun_LogsWhatTheScanCovers(t *testing.T) {
	mock := &mockDiscoveryMCPClient{tools: []mcp.Tool{{Name: "calc"}}}
	cfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{Type: "http", URL: "https://user:pw@mcp.example.com/rpc"},
		Endpoints: []swagger.EndpointConfig{{Method: "GET", Path: "/a"}, {Method: "POST", Path: "/b"}},
		Settings:  swagger.Settings{EnableMCPMethodFuzzing: boolPtr(false)},
	}
	r := New(cfg, nil)
	defer r.Close()
	r.mcpClient = mock
	sub := r.Subscribe()

	_, err := r.initRun(context.Background())
	require.NoError(t, err)
	defer r.finaliseRun()
	assert.Contains(t, logsAt(userLogs(t, sub), "info"), "Scan targets: 2 API endpoint(s), MCP server mcp.example.com with 1 endpoint(s)")
}

func TestMCPServerLabel_NeverShowsCredentialsOrCommands(t *testing.T) {
	assert.Equal(t, "mcp.example.com:8443", mcpServerLabel(&swagger.MCPServerConfig{URL: "https://u:p@mcp.example.com:8443/x?key=1"}))
	assert.Equal(t, "(local command)", mcpServerLabel(&swagger.MCPServerConfig{Type: "stdio", Command: "run", Args: []string{"--token=abc"}}))
	assert.Equal(t, "(invalid URL)", mcpServerLabel(&swagger.MCPServerConfig{URL: "::not a url"}))
	assert.Equal(t, "", mcpServerLabel(nil))
}

func boolPtr(b bool) *bool { return &b }

// Go's HTTP errors quote the full URL; the MCP server's token must not reach the user's log, the
// scan's failure reason, or the dashboard.
func TestInitRun_MCPErrorsNeverShowTheURLsCredentials(t *testing.T) {
	leaky := errors.New(`Get "https://user:pw@mcp.example.com/sse?token=SECRET#frag": dial tcp 10.0.0.1:443: connection refused`)
	cfg := &swagger.Config{MCPServer: &swagger.MCPServerConfig{Type: "sse", URL: "https://user:pw@mcp.example.com/sse?token=SECRET"}}
	r := New(cfg, nil)
	defer r.Close()
	r.mcpClient = &failingMCPClient{connectErr: leaky}
	sub := r.Subscribe()

	_, err := r.initRun(context.Background())
	require.Error(t, err)
	for _, text := range append(logsAt(userLogs(t, sub), "error"), err.Error()) {
		assert.NotContains(t, text, "SECRET")
		assert.NotContains(t, text, "pw")
		assert.Contains(t, text, "https://…@mcp.example.com/…?…#…")
	}
}

func TestRedactURLs(t *testing.T) {
	assert.Equal(t, `open https://h.example/…?… and wss://…@x.io:8443/… now`, redactURLs(`open https://h.example/p?a=1&b=2 and wss://u:p@x.io:8443/ws now`))
	// Hosted MCP servers often put the key in the path.
	assert.Equal(t, `Post "https://mcp.example.com/…": 401`, redactURLs(`Post "https://mcp.example.com/api/mcp/s/sk_live_SECRET/sse": 401`))
	assert.Equal(t, "no urls here", redactURLs("no urls here"))
	assert.Equal(t, "http://h", redactURLs("http://h/"))
	assert.Equal(t, "(URL)", redactURLs("http://%zz"))
}

// runEvents collects the types of the events broadcast until the stream is quiet, and the data
// of the last error.
func runEvents(t *testing.T, sub chan Event) (types []string, errData any) {
	t.Helper()
	for {
		select {
		case ev, ok := <-sub:
			if !ok {
				return
			}
			types = append(types, ev.Type)
			if ev.Type == EventError {
				errData = ev.Data
			}
		case <-time.After(300 * time.Millisecond):
			return
		}
	}
}

// A panic during the run unwinds through Start's deferred finalisation, which used to broadcast
// "complete": the scan was stored as completed, with partial results, and the user never learned
// it broke. It must end with an error, and the panic must still propagate.
func TestStart_PanicEndsTheRunWithAnErrorNotComplete(t *testing.T) {
	r := New(&swagger.Config{Endpoints: []swagger.EndpointConfig{{Method: "GET", Path: "/a"}}}, nil)
	defer r.Close()
	r.afterInitHook = func(context.Context) { panic("boom in the profile loop") }
	sub := r.Subscribe()

	assert.PanicsWithValue(t, "boom in the profile loop", func() { _ = r.Start(context.Background()) })
	assert.False(t, r.IsRunning())
	types, errData := runEvents(t, sub)
	assert.Contains(t, types, EventError)
	assert.NotContains(t, types, EventComplete)
	assert.Equal(t, RunPanicMessage, errData)
}

// A worker still sending its stats when Start panics must not be hit by the channel closing
// under it: that panic, in its own goroutine, used to take the whole agent down.
func TestStart_PanicWaitsForWorkersBeforeClosingTheirStatsChannel(t *testing.T) {
	r := New(&swagger.Config{Endpoints: []swagger.EndpointConfig{{Method: "GET", Path: "/a"}}}, nil)
	defer r.Close()
	sending := make(chan struct{})
	r.afterInitHook = func(ctx context.Context) {
		r.goWorker(func() {
			close(sending)
			for {
				select {
				case <-ctx.Done():
					return
				case r.statsChan <- statsMsg{result: &swagger.FuzzResult{Status: 200}}:
				}
			}
		})
		<-sending
		panic("boom while a worker sends")
	}

	assert.Panics(t, func() { _ = r.Start(context.Background()) })
	assert.False(t, r.workerPanicked.Load(), "the worker stopped on the cancelled run, not on a closed channel")
}

// A panic in a worker (an analyzer, a generator) used to crash the agent with every run on it,
// and the scan only ended when the watchdog gave up on it. Now it stops this run, with an error.
func TestStart_WorkerPanicEndsTheRunWithAnError(t *testing.T) {
	r := New(&swagger.Config{Endpoints: []swagger.EndpointConfig{{Method: "GET", Path: "/a"}}}, nil)
	defer r.Close()
	r.afterInitHook = func(context.Context) {
		r.goWorker(func() { panic("nil dereference in an analyzer") })
		require.True(t, r.waitWorkers(time.Second))
	}
	sub := r.Subscribe()

	assert.NotPanics(t, func() { _ = r.Start(context.Background()) })
	types, errData := runEvents(t, sub)
	assert.Contains(t, types, EventError)
	assert.NotContains(t, types, EventComplete)
	assert.Equal(t, RunPanicMessage, errData)

	// The next run starts clean.
	r.afterInitHook = nil
	_, err := r.initRun(context.Background())
	require.NoError(t, err)
	assert.False(t, r.workerPanicked.Load())
	r.finaliseRun()
}

// A config that names only browser WebMCP tools is still an explicit MCP allowlist: the MCP
// server's own tools must not be added to the scan behind the user's back.
func TestMCPDiscovery_WebMCPToolsKeepTheConfigAnAllowlist(t *testing.T) {
	mock := &mockDiscoveryMCPClient{tools: []mcp.Tool{{Name: "server_only_tool"}}}
	cfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{Type: "stdio"},
		Endpoints: []swagger.EndpointConfig{{Method: "CALL", Path: "webmcp://tool/search"}},
		Settings:  swagger.Settings{EnableMCPMethodFuzzing: boolPtr(false)},
	}
	r := New(cfg, nil)
	defer r.Close()
	r.mcpClient = mock

	_, err := r.initRun(context.Background())
	require.NoError(t, err)
	defer r.finaliseRun()
	for _, ep := range r.config.Endpoints {
		assert.NotEqual(t, "mcp://tool/server_only_tool", ep.Path)
	}
}
