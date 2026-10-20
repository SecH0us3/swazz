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
