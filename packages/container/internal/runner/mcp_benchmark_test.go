// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"net/http"
	"testing"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/swagger"
)

type benchMCPClient struct {
	toolResult     *mcp.CallToolResult
	resourceResult *mcp.ReadResourceResult
	promptResult   *mcp.GetPromptResult
}

func (b *benchMCPClient) Connect(ctx context.Context) error { return nil }
func (b *benchMCPClient) Close() error                      { return nil }
func (b *benchMCPClient) ListTools(ctx context.Context) ([]mcp.Tool, error) {
	return nil, nil
}
func (b *benchMCPClient) CallTool(ctx context.Context, name string, args map[string]any, extraHeaders map[string]string) (*mcp.CallToolResult, string, error) {
	return b.toolResult, "", nil
}
func (b *benchMCPClient) ListResources(ctx context.Context) ([]mcp.Resource, error) {
	return nil, nil
}
func (b *benchMCPClient) ReadResource(ctx context.Context, uri string, extraHeaders map[string]string) (*mcp.ReadResourceResult, string, error) {
	return b.resourceResult, "", nil
}
func (b *benchMCPClient) ListPrompts(ctx context.Context) ([]mcp.Prompt, error) {
	return nil, nil
}
func (b *benchMCPClient) GetPrompt(ctx context.Context, name string, args map[string]any, extraHeaders map[string]string) (*mcp.GetPromptResult, string, error) {
	return b.promptResult, "", nil
}

func BenchmarkExecuteMCPRequest_ToolCall(b *testing.B) {
	fake := &benchMCPClient{
		toolResult: &mcp.CallToolResult{
			RawJSON: []byte(`{"status":"ok","account":{"id":"123","balance":100.50}}`),
			Content: []mcp.Content{
				{Type: "text", Text: `{"status":"ok","account":{"id":"123","balance":100.50}}`},
			},
		},
	}
	reg := analyzer.NewRegistry()
	cfg := &swagger.Config{
		Settings: swagger.Settings{
			TimeoutMs:           5000,
			AnalyzeResponseBody: true,
		},
	}
	r := &Runner{
		client:    &http.Client{},
		config:    cfg,
		mcpClient: fake,
		analyzer:  reg,
	}

	payload := map[string]any{
		"accountId": "12345",
		"amount":    100.5,
		"currency":  "EUR",
	}

	b.ResetTimer()
	b.ReportAllocs()
	ctx := context.Background()

	for i := 0; i < b.N; i++ {
		_ = r.executeMCPRequest(ctx, "mcp://tool/transferFunds", payload, swagger.ProfileMalicious, nil, nil)
	}
}

func BenchmarkExecuteMCPRequest_ResourceRead(b *testing.B) {
	fake := &benchMCPClient{
		resourceResult: &mcp.ReadResourceResult{
			RawJSON: []byte(`{"contents":[{"uri":"file:///etc/hosts","text":"127.0.0.1 localhost\n::1 localhost"}]}`),
			Contents: []mcp.ResourceContent{
				{URI: "file:///etc/hosts", Text: "127.0.0.1 localhost\n::1 localhost"},
			},
		},
	}
	reg := analyzer.NewRegistry()
	cfg := &swagger.Config{
		Settings: swagger.Settings{
			TimeoutMs:           5000,
			AnalyzeResponseBody: true,
		},
	}
	r := &Runner{
		client:    &http.Client{},
		config:    cfg,
		mcpClient: fake,
		analyzer:  reg,
	}

	payload := map[string]any{
		"uri": "file:///etc/hosts",
	}

	b.ResetTimer()
	b.ReportAllocs()
	ctx := context.Background()

	for i := 0; i < b.N; i++ {
		_ = r.executeMCPRequest(ctx, "mcp://resource/file:///etc/hosts", payload, swagger.ProfileMalicious, nil, nil)
	}
}

func BenchmarkExecuteMCPRequest_PromptGet(b *testing.B) {
	fake := &benchMCPClient{
		promptResult: &mcp.GetPromptResult{
			RawJSON:     []byte(`{"description":"Review code","messages":[{"role":"user","content":{"type":"text","text":"Please review: func main() {}"}}]}`),
			Description: "Review code",
			Messages: []mcp.PromptMessage{
				{Role: "user", Content: mcp.PromptContent{Type: "text", Text: "Please review: func main() {}"}},
			},
		},
	}
	reg := analyzer.NewRegistry()
	cfg := &swagger.Config{
		Settings: swagger.Settings{
			TimeoutMs:           5000,
			AnalyzeResponseBody: true,
		},
	}
	r := &Runner{
		client:    &http.Client{},
		config:    cfg,
		mcpClient: fake,
		analyzer:  reg,
	}

	payload := map[string]any{
		"code": "func main() {}",
	}

	b.ResetTimer()
	b.ReportAllocs()
	ctx := context.Background()

	for i := 0; i < b.N; i++ {
		_ = r.executeMCPRequest(ctx, "mcp://prompt/reviewCode", payload, swagger.ProfileMalicious, nil, nil)
	}
}

func BenchmarkExecuteMCPRequest_ToolCall_Boundary(b *testing.B) {
	fake := &benchMCPClient{
		toolResult: &mcp.CallToolResult{
			RawJSON: []byte(`{"status":"ok","account":{"id":"123","balance":100.50}}`),
			Content: []mcp.Content{
				{Type: "text", Text: `{"status":"ok","account":{"id":"123","balance":100.50}}`},
			},
		},
	}
	reg := analyzer.NewRegistry()
	cfg := &swagger.Config{
		Settings: swagger.Settings{
			TimeoutMs:           5000,
			AnalyzeResponseBody: true,
		},
	}
	r := &Runner{
		client:    &http.Client{},
		config:    cfg,
		mcpClient: fake,
		analyzer:  reg,
	}

	payload := map[string]any{
		"accountId": "999999999999999999999999999999999999",
		"amount":    -9223372036854775808,
		"currency":  "",
	}

	b.ResetTimer()
	b.ReportAllocs()
	ctx := context.Background()

	for i := 0; i < b.N; i++ {
		_ = r.executeMCPRequest(ctx, "mcp://tool/transferFunds", payload, swagger.ProfileBoundary, nil, nil)
	}
}

func BenchmarkExecuteMCPRequest_ResourceRead_Boundary(b *testing.B) {
	fake := &benchMCPClient{
		resourceResult: &mcp.ReadResourceResult{
			RawJSON: []byte(`{"contents":[{"uri":"file:///etc/hosts","text":"127.0.0.1 localhost\n::1 localhost"}]}`),
			Contents: []mcp.ResourceContent{
				{URI: "file:///etc/hosts", Text: "127.0.0.1 localhost\n::1 localhost"},
			},
		},
	}
	reg := analyzer.NewRegistry()
	cfg := &swagger.Config{
		Settings: swagger.Settings{
			TimeoutMs:           5000,
			AnalyzeResponseBody: true,
		},
	}
	r := &Runner{
		client:    &http.Client{},
		config:    cfg,
		mcpClient: fake,
		analyzer:  reg,
	}

	payload := map[string]any{
		"uri": "file:///" + string(make([]byte, 8192)),
	}

	b.ResetTimer()
	b.ReportAllocs()
	ctx := context.Background()

	for i := 0; i < b.N; i++ {
		_ = r.executeMCPRequest(ctx, "mcp://resource/file:///etc/hosts", payload, swagger.ProfileBoundary, nil, nil)
	}
}

func BenchmarkExecuteMCPRequest_PromptGet_Boundary(b *testing.B) {
	fake := &benchMCPClient{
		promptResult: &mcp.GetPromptResult{
			RawJSON:     []byte(`{"description":"Review code","messages":[{"role":"user","content":{"type":"text","text":"Please review: func main() {}"}}]}`),
			Description: "Review code",
			Messages: []mcp.PromptMessage{
				{Role: "user", Content: mcp.PromptContent{Type: "text", Text: "Please review: func main() {}"}},
			},
		},
	}
	reg := analyzer.NewRegistry()
	cfg := &swagger.Config{
		Settings: swagger.Settings{
			TimeoutMs:           5000,
			AnalyzeResponseBody: true,
		},
	}
	r := &Runner{
		client:    &http.Client{},
		config:    cfg,
		mcpClient: fake,
		analyzer:  reg,
	}

	payload := map[string]any{
		"code": string(make([]byte, 16384)),
	}

	b.ResetTimer()
	b.ReportAllocs()
	ctx := context.Background()

	for i := 0; i < b.N; i++ {
		_ = r.executeMCPRequest(ctx, "mcp://prompt/reviewCode", payload, swagger.ProfileBoundary, nil, nil)
	}
}
