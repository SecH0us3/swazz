// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"swazz-engine/internal/analyzer"
	"swazz-engine/internal/mcp"
	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdaptiveRateLimitAndUA(t *testing.T) {
	var mu sync.Mutex
	attempts := 0
	var userAgents []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		userAgents = append(userAgents, r.Header.Get("User-Agent"))
		if attempts == 0 {
			attempts++
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		attempts++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Settings: swagger.Settings{
			EnableAdaptiveRateLimit: true,
			RandomizeUserAgent:      true,
			TimeoutMs:               5000,
		},
	}
	// We need a minimal runner
	runner := &Runner{
		client: server.Client(),
		config: cfg,
	}

	start := time.Now()
	res := runner.executeRequest(context.Background(), server.URL, "/", "/", "GET", nil, nil, nil, swagger.ProfileRandom, nil, nil, "")
	duration := time.Since(start)

	mu.Lock()
	attemptsVal := attempts
	userAgentsVal := make([]string, len(userAgents))
	copy(userAgentsVal, userAgents)
	mu.Unlock()

	assert.Equal(t, 200, res.Status)
	assert.Equal(t, 2, attemptsVal)
	assert.GreaterOrEqual(t, duration.Seconds(), 1.0, "Should have backed off for at least 1 second based on Retry-After")

	// Ensure UA was randomized, not the default
	assert.NotEmpty(t, userAgentsVal)
	for _, ua := range userAgentsVal {
		assert.NotEqual(t, "Swazz/1.0 (+https://github.com/SecH0us3/swazz)", ua)
	}
}

func TestExecuteGRPCRequest_Basic(t *testing.T) {
	r := &Runner{
		config: &swagger.Config{
			BaseURL: "127.0.0.1:50051",
			Settings: swagger.Settings{
				TimeoutMs: 1000,
			},
		},
	}
	defer r.Close()
	res := r.executeGRPCRequest(context.Background(), "127.0.0.1:50051", "/demo.UserService/GetUser", "/demo.UserService/GetUser", map[string]any{"id": 1}, swagger.ProfileRandom, nil)
	assert.NotNil(t, res)
	assert.Equal(t, "GRPC", res.Method)
	assert.Equal(t, "/demo.UserService/GetUser", res.Endpoint)
}

func TestExecuteGRPCRequest_LiveServerAndAnalyzer(t *testing.T) {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer lis.Close()

	srv := grpc.NewServer(
		grpc.UnknownServiceHandler(func(srv interface{}, stream grpc.ServerStream) error {
			return status.Error(codes.Internal, "panic: runtime error: invalid memory address")
		}),
	)
	go func() {
		_ = srv.Serve(lis)
	}()
	defer srv.Stop()

	r := &Runner{
		config: &swagger.Config{
			BaseURL: "grpc://" + lis.Addr().String(),
			GlobalHeaders: map[string]string{
				"Authorization": "Bearer test-jwt",
			},
			Settings: swagger.Settings{
				TimeoutMs:           2000,
				AnalyzeResponseBody: true,
			},
		},
		analyzer: analyzer.NewRegistry(),
	}
	defer r.Close()

	res := r.executeGRPCRequest(
		context.Background(),
		"grpc://"+lis.Addr().String(),
		"/demo.UserService/GetUser",
		"/demo.UserService/GetUser",
		map[string]any{"id": 1},
		swagger.ProfileMalicious,
		map[string]string{"X-Trace": "123"},
	)

	require.NotNil(t, res)
	assert.Equal(t, "GRPC", res.Method)
	assert.Equal(t, 500, res.Status)
	assert.Contains(t, res.RequestHeaders, "Authorization")
	assert.Contains(t, res.RequestHeaders, "X-Trace")
	require.NotEmpty(t, res.AnalyzerFindings)
	var foundGrpcInternal bool
	for _, f := range res.AnalyzerFindings {
		if f.RuleID == "swazz/grpc-internal-error" {
			foundGrpcInternal = true
			break
		}
	}
	assert.True(t, foundGrpcInternal, "expected finding swazz/grpc-internal-error to be captured")
}

// fakeMCPClient records the extraHeaders it was called with, to prove the BOLA
// phase's second-identity headers actually reach the wire.
type fakeMCPClient struct {
	lastTool       string
	lastHeaders    map[string]string
	resourceText   string // overrides the text returned by ReadResource when non-empty
	callToolResult *mcp.CallToolResult
	callToolStderr string
	callToolErr    error
}

func (f *fakeMCPClient) Connect(context.Context) error       { return nil }
func (f *fakeMCPClient) ListTools(context.Context) ([]mcp.Tool, error) { return nil, nil }
func (f *fakeMCPClient) Close() error                        { return nil }
func (f *fakeMCPClient) CallTool(_ context.Context, name string, _ map[string]any, extraHeaders map[string]string) (*mcp.CallToolResult, string, error) {
	f.lastTool = name
	f.lastHeaders = extraHeaders
	if f.callToolResult != nil || f.callToolErr != nil || f.callToolStderr != "" {
		return f.callToolResult, f.callToolStderr, f.callToolErr
	}
	return &mcp.CallToolResult{Content: []mcp.Content{{Type: "text", Text: "ok"}}}, "", nil
}
func (f *fakeMCPClient) ListResources(context.Context) ([]mcp.Resource, error) { return nil, nil }
func (f *fakeMCPClient) ReadResource(_ context.Context, uri string, extraHeaders map[string]string) (*mcp.ReadResourceResult, string, error) {
	f.lastTool = uri
	f.lastHeaders = extraHeaders
	text := "resource data"
	if f.resourceText != "" {
		text = f.resourceText
	}
	return &mcp.ReadResourceResult{Contents: []mcp.ResourceContent{{URI: uri, Text: text}}}, "", nil
}
func (f *fakeMCPClient) ListPrompts(context.Context) ([]mcp.Prompt, error) { return nil, nil }
func (f *fakeMCPClient) GetPrompt(_ context.Context, name string, _ map[string]any, extraHeaders map[string]string) (*mcp.GetPromptResult, string, error) {
	f.lastTool = name
	f.lastHeaders = extraHeaders
	return &mcp.GetPromptResult{Description: name, Messages: []mcp.PromptMessage{{Role: "user", Content: mcp.PromptContent{Type: "text", Text: "prompt data"}}}}, "", nil
}

func TestExecuteMCPRequest_ForwardsIdentityHeaders(t *testing.T) {
	fake := &fakeMCPClient{}
	r := &Runner{
		client:    &http.Client{},
		config:    &swagger.Config{Settings: swagger.Settings{TimeoutMs: 5000}},
		mcpClient: fake,
	}

	// Simulate the BOLA phase replaying a tool as identity B.
	identityB := map[string]string{"Authorization": "Bearer token-B"}
	cookiesB := map[string]string{"sess": "b-sess"}

	res := r.executeMCPRequest(
		context.Background(),
		"mcp://tool/listTransactions",
		map[string]any{"startDate": "2026-01-01"},
		swagger.FuzzingProfile("BOLA"),
		identityB, cookiesB,
	)

	assert.Equal(t, 200, res.Status)
	assert.Equal(t, "listTransactions", fake.lastTool)
	assert.Equal(t, "Bearer token-B", fake.lastHeaders["Authorization"],
		"identity B's token must reach CallTool, else BOLA on MCP tests nothing")
	assert.Equal(t, "sess=b-sess", fake.lastHeaders["Cookie"])
}

func TestExecuteMCPRequest_NoIdentityMeansNoOverride(t *testing.T) {
	fake := &fakeMCPClient{}
	r := &Runner{
		client:    &http.Client{},
		config:    &swagger.Config{Settings: swagger.Settings{TimeoutMs: 5000}},
		mcpClient: fake,
	}

	// Main phase with no per-identity headers: nothing overrides the client's base.
	r.executeMCPRequest(context.Background(), "mcp://tool/getCardDetails", nil,
		swagger.ProfileRandom, nil, nil)

	assert.Nil(t, fake.lastHeaders, "no identity headers => no per-call override map")
}

func TestExecuteMCPRequest_ResourcesAndPrompts(t *testing.T) {
	fake := &fakeMCPClient{}
	r := &Runner{
		client:    &http.Client{},
		config:    &swagger.Config{Settings: swagger.Settings{TimeoutMs: 5000}},
		mcpClient: fake,
	}

	// Resource read
	resRes := r.executeMCPRequest(
		context.Background(),
		"mcp://resource/file:///etc/hosts",
		map[string]any{"uri": "file:///etc/hosts"},
		swagger.ProfileRandom,
		nil, nil,
	)
	assert.Equal(t, 200, resRes.Status)
	assert.Equal(t, "READ", resRes.Method)
	assert.Contains(t, resRes.ResponseBody, "resource data")

	// Prompt evaluation
	promptRes := r.executeMCPRequest(
		context.Background(),
		"mcp://prompt/summarize_code",
		map[string]any{"code": "func main() {}"},
		swagger.ProfileRandom,
		nil, nil,
	)
	assert.Equal(t, 200, promptRes.Status)
	assert.Equal(t, "PROMPT", promptRes.Method)
	assert.Contains(t, promptRes.ResponseBody, "prompt data")
}

// TestExecuteMCPRequest_ResourceLeakAnalyzerFires verifies the fix for the bug where
// AnalysisInput.Method was hardcoded to "CALL" for all MCP calls.
// With the fix, READ requests carry method="READ", enabling isMCPEndpoint() to match
// and swazz/mcp-resource-leak to fire when the response contains /etc/passwd content.
func TestExecuteMCPRequest_ResourceLeakAnalyzerFires(t *testing.T) {
	fake := &fakeMCPClient{}
	// Return /etc/passwd content to trigger the swazz/mcp-resource-leak rule.
	fake.resourceText = "root:x:0:0:root:/root:/bin/bash"

	reg := analyzer.NewRegistry()
	r := &Runner{
		client: &http.Client{},
		config: &swagger.Config{Settings: swagger.Settings{
			TimeoutMs:           5000,
			AnalyzeResponseBody: true,
		}},
		mcpClient: fake,
		analyzer:  reg,
	}

	res := r.executeMCPRequest(
		context.Background(),
		"mcp://resource/file:///etc/passwd",
		map[string]any{"uri": "file:///etc/passwd"},
		swagger.ProfileRandom,
		nil, nil,
	)

	assert.Equal(t, "READ", res.Method)
	var found bool
	for _, f := range res.AnalyzerFindings {
		if f.RuleID == "swazz/mcp-resource-leak" {
			found = true
			break
		}
	}
	assert.True(t, found, "swazz/mcp-resource-leak must fire for READ responses with /etc/passwd content")
}

func TestExecuteMCPRequest_ClientNil(t *testing.T) {
	r := &Runner{
		client: &http.Client{},
		config: &swagger.Config{},
	}
	res := r.executeMCPRequest(context.Background(), "mcp://tool/test", nil, swagger.ProfileRandom, nil, nil)
	assert.Equal(t, 500, res.Status)
	assert.Contains(t, res.Error, "MCP client is not initialized")
}

func TestExecuteMCPRequest_StructPayload(t *testing.T) {
	fake := &fakeMCPClient{}
	r := &Runner{
		client:    &http.Client{},
		config:    &swagger.Config{},
		mcpClient: fake,
	}
	type customPayload struct {
		Query string `json:"query"`
	}
	res := r.executeMCPRequest(context.Background(), "mcp://tool/search", customPayload{Query: "test"}, swagger.ProfileRandom, nil, nil)
	assert.Equal(t, 200, res.Status)
}

func TestExecuteMCPRequest_ToolErrorAndCrash(t *testing.T) {
	// 1. Tool execution error with crash message
	fakeCrash := &fakeMCPClient{
		callToolErr:    fmt.Errorf("exit status 1: process terminated unexpectedly"),
		callToolStderr: "fatal panic in MCP server",
	}
	r := &Runner{
		client:    &http.Client{},
		config:    &swagger.Config{},
		mcpClient: fakeCrash,
	}
	res := r.executeMCPRequest(context.Background(), "mcp://tool/crash_tool", nil, swagger.ProfileRandom, nil, nil)
	assert.Equal(t, 500, res.Status)
	assert.Contains(t, res.ResponseBody, "fatal panic")
	var foundCrash bool
	for _, f := range res.AnalyzerFindings {
		if f.RuleID == "swazz/mcp-server-crash" {
			foundCrash = true
			break
		}
	}
	assert.True(t, foundCrash, "swazz/mcp-server-crash finding must be generated on process exit")

	// 3. Error without stderr
	fakeErrNoStderr := &fakeMCPClient{
		callToolErr: fmt.Errorf("simple error"),
	}
	rNoStderr := &Runner{
		client:    &http.Client{},
		config:    &swagger.Config{},
		mcpClient: fakeErrNoStderr,
	}
	resNoStderr := rNoStderr.executeMCPRequest(context.Background(), "mcp://tool/err_no_stderr", nil, swagger.ProfileRandom, nil, nil)
	assert.Equal(t, 500, resNoStderr.Status)
	assert.Contains(t, resNoStderr.ResponseBody, "Error: simple error")

	// 4. Rate limiter rejection
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	rl := mcp.NewRateLimiter(1, 1)
	// drain limiter burst
	for i := 0; i < 15; i++ {
		_ = rl.Allow(context.Background())
	}
	rRL := &Runner{
		client:         &http.Client{},
		config:         &swagger.Config{},
		mcpClient:      &fakeMCPClient{},
		mcpRateLimiter: rl,
	}
	resRL := rRL.executeMCPRequest(cancelledCtx, "mcp://tool/rate_limited", nil, swagger.ProfileRandom, nil, nil)
	assert.Equal(t, 429, resRL.Status)
	assert.Contains(t, resRL.Error, "Rate limit exceeded")
}

