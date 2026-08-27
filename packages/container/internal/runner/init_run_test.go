// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"testing"

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
		Settings: swagger.Settings{
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
