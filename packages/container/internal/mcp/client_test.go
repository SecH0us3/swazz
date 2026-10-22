// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package mcp

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHelperProcess is a mock helper process that executes in a subprocess to simulate a stdio MCP server.
func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS") != "1" {
		return
	}

	if os.Getenv("GO_HELPER_CRASH") == "1" {
		fmt.Fprintln(os.Stderr, "intentional crash")
		os.Exit(1)
	}

	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		line := scanner.Text()
		var req Request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			continue
		}

		var response Response
		response.JSONRPC = "2.0"
		response.ID = req.ID

		switch req.Method {
		case "initialize":
			initResult := map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{},
				"serverInfo": map[string]any{
					"name":    "mock-server",
					"version": "1.0.0",
				},
			}
			resBytes, _ := json.Marshal(initResult)
			response.Result = resBytes

		case "notifications/initialized":
			continue

		case "tools/list":
			tools := []Tool{
				{
					Name:        "get_weather",
					Description: "Gets the weather",
					InputSchema: swagger.SchemaProperty{
						Type: "object",
					},
				},
			}
			result := map[string]any{
				"tools": tools,
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes

		case "tools/call":
			var callArgs struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			_ = json.Unmarshal(req.Params, &callArgs)

			if callArgs.Name == "get_weather" {
				result := CallToolResult{
					Content: []Content{
						{
							Type: "text",
							Text: "Sunny",
						},
					},
				}
				resBytes, _ := json.Marshal(result)
				response.Result = resBytes
			} else if callArgs.Name == "crash" {
				fmt.Fprintln(os.Stderr, "crashing process")
				os.Exit(42)
			} else {
				response.Error = &RPCError{
					Code:    -32601,
					Message: "Method not found",
				}
			}

		case "resources/list":
			resources := []Resource{
				{
					URI:         "file:///etc/config.json",
					Name:        "config",
					Description: "Server configuration",
					MIMEType:    "application/json",
				},
			}
			resBytes, _ := json.Marshal(map[string]any{"resources": resources})
			response.Result = resBytes

		case "resources/read":
			var readArgs struct {
				URI string `json:"uri"`
			}
			_ = json.Unmarshal(req.Params, &readArgs)
			result := ReadResourceResult{
				Contents: []ResourceContent{
					{
						URI:      readArgs.URI,
						MIMEType: "text/plain",
						Text:     "sample content",
					},
				},
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes

		case "prompts/list":
			prompts := []Prompt{
				{
					Name:        "review_code",
					Description: "Reviews code",
					Arguments: []PromptArgument{
						{Name: "code", Description: "code snippet", Required: true},
					},
				},
			}
			resBytes, _ := json.Marshal(map[string]any{"prompts": prompts})
			response.Result = resBytes

		case "prompts/get":
			var getArgs struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			_ = json.Unmarshal(req.Params, &getArgs)
			result := GetPromptResult{
				Description: "Code review prompt",
				Messages: []PromptMessage{
					{
						Role: "user",
						Content: PromptContent{
							Type: "text",
							Text: "Please review: " + fmt.Sprintf("%v", getArgs.Arguments["code"]),
						},
					},
				},
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes
		}

		respBytes, _ := json.Marshal(response)
		stdout := os.NewFile(1, "stdout")
		_, _ = stdout.Write(append(respBytes, '\n'))
	}
	os.Exit(0)
}

func TestStdioClient_Success(t *testing.T) {
	t.Setenv("GO_WANT_HELPER_PROCESS", "1")

	cmdPath := os.Args[0]
	args := []string{"-test.run=TestHelperProcess", "--"}

	client := NewStdioClient(cmdPath, args)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	if err != nil {
		t.Errorf("Connect failed with error: %v", err)
	}
	require.NoError(t, err)
	defer func() {
		_ = client.Close()
	}()

	// Test ListTools
	tools, err := client.ListTools(ctx)
	require.NoError(t, err)
	require.Len(t, tools, 1)

	// Test ListResources
	resources, err := client.ListResources(ctx)
	require.NoError(t, err)
	require.Len(t, resources, 1)
	assert.Equal(t, "file:///etc/config.json", resources[0].URI)

	// Test ReadResource
	readRes, _, err := client.ReadResource(ctx, "file:///etc/config.json", nil)
	require.NoError(t, err)
	require.Len(t, readRes.Contents, 1)
	assert.Equal(t, "sample content", readRes.Contents[0].Text)

	// Test ListPrompts
	prompts, err := client.ListPrompts(ctx)
	require.NoError(t, err)
	require.Len(t, prompts, 1)
	assert.Equal(t, "review_code", prompts[0].Name)

	// Test GetPrompt
	promptRes, _, err := client.GetPrompt(ctx, "review_code", map[string]any{"code": "foo()"}, nil)
	require.NoError(t, err)
	require.Len(t, promptRes.Messages, 1)
	assert.Contains(t, promptRes.Messages[0].Content.Text, "foo()")
	assert.Equal(t, "get_weather", tools[0].Name)

	// Test CallTool
	res, stderr, err := client.CallTool(ctx, "get_weather", map[string]any{"city": "Paris"}, nil)
	require.NoError(t, err)
	assert.Empty(t, stderr)
	require.Len(t, res.Content, 1)
	assert.Equal(t, "text", res.Content[0].Type)
	assert.Equal(t, "Sunny", res.Content[0].Text)
}

func TestStdioClient_CrashOnStart(t *testing.T) {
	t.Setenv("GO_WANT_HELPER_PROCESS", "1")
	t.Setenv("GO_HELPER_CRASH", "1")

	cmdPath := os.Args[0]
	args := []string{"-test.run=TestHelperProcess", "--"}

	client := NewStdioClient(cmdPath, args)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	assert.Error(t, err)
}

func TestStdioClient_CrashOnCall(t *testing.T) {
	t.Setenv("GO_WANT_HELPER_PROCESS", "1")

	cmdPath := os.Args[0]
	args := []string{"-test.run=TestHelperProcess", "--"}

	client := NewStdioClient(cmdPath, args)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	if err != nil {
		t.Errorf("Connect failed with error: %v", err)
	}
	require.NoError(t, err)
	defer func() {
		_ = client.Close()
	}()

	// Call tool that triggers exit 42
	res, _, err := client.CallTool(ctx, "crash", nil, nil)
	assert.Error(t, err)
	assert.Nil(t, res)
	assert.Contains(t, err.Error(), "exit status 42")

	// Test extraHeaders rejection for Stdio transport
	_, _, err = client.CallTool(ctx, "get_weather", nil, map[string]string{"Auth": "token"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cannot switch identity")

	_, _, err = client.ReadResource(ctx, "file:///test", map[string]string{"Auth": "token"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cannot switch identity")

	_, _, err = client.GetPrompt(ctx, "test_prompt", nil, map[string]string{"Auth": "token"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cannot switch identity")
}

func TestStdioClient_ClosedOperations(t *testing.T) {
	t.Setenv("GO_WANT_HELPER_PROCESS", "1")
	cmdPath := os.Args[0]
	args := []string{"-test.run=TestHelperProcess", "--"}

	client := NewStdioClient(cmdPath, args)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	require.NoError(t, client.Connect(ctx))
	assert.NoError(t, client.Close())
	assert.NoError(t, client.Close()) // Idempotent close

	_, err := client.sendRequest(context.Background(), "test", nil, nil)
	assert.Equal(t, io.ErrClosedPipe, err)
}

type mockSSEServer struct {
	mu         sync.Mutex
	writeChan  chan string
	noEndpoint bool
}

func (s *mockSSEServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
			return
		}
		flusher.Flush()

		s.mu.Lock()
		noEndpoint := s.noEndpoint
		s.mu.Unlock()

		if !noEndpoint {
			writeURL := "http://" + r.Host + "/message"
			fmt.Fprintf(w, "event: endpoint\ndata: %s\n\n", writeURL)
			flusher.Flush()
		}

		for {
			select {
			case msg, ok := <-s.writeChan:
				if !ok {
					return
				}
				fmt.Fprintf(w, "event: message\ndata: %s\n\n", msg)
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	} else if r.Method == "POST" {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var req Request
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var response Response
		response.JSONRPC = "2.0"
		response.ID = req.ID

		switch req.Method {
		case "initialize":
			initResult := map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{},
				"serverInfo": map[string]any{
					"name":    "mock-sse-server",
					"version": "1.0.0",
				},
			}
			resBytes, _ := json.Marshal(initResult)
			response.Result = resBytes

		case "notifications/initialized":
			w.WriteHeader(http.StatusAccepted)
			return

		case "tools/list":
			tools := []Tool{
				{
					Name:        "sse_tool",
					Description: "SSE tool description",
					InputSchema: swagger.SchemaProperty{
						Type: "object",
					},
				},
			}
			result := map[string]any{
				"tools": tools,
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes

		case "tools/call":
			var callArgs struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			}
			_ = json.Unmarshal(req.Params, &callArgs)

			if callArgs.Name == "sse_tool" {
				result := CallToolResult{
					Content: []Content{
						{
							Type: "text",
							Text: "SSE Success",
						},
					},
				}
				resBytes, _ := json.Marshal(result)
				response.Result = resBytes
			} else {
				response.Error = &RPCError{
					Code:    -32601,
					Message: "Method not found",
				}
			}

		case "resources/list":
			resources := []Resource{
				{
					URI:  "file:///etc/sse.conf",
					Name: "sse_conf",
				},
			}
			resBytes, _ := json.Marshal(map[string]any{"resources": resources})
			response.Result = resBytes

		case "resources/read":
			result := ReadResourceResult{
				Contents: []ResourceContent{
					{
						URI:  "file:///etc/sse.conf",
						Text: "sse-content",
					},
				},
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes

		case "prompts/list":
			prompts := []Prompt{
				{
					Name:        "sse_prompt",
					Description: "SSE prompt",
				},
			}
			resBytes, _ := json.Marshal(map[string]any{"prompts": prompts})
			response.Result = resBytes

		case "prompts/get":
			result := GetPromptResult{
				Description: "SSE prompt description",
				Messages: []PromptMessage{
					{
						Role:    "user",
						Content: PromptContent{Type: "text", Text: "rendered sse prompt"},
					},
				},
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes
		}

		respBytes, _ := json.Marshal(response)
		s.writeChan <- string(respBytes)

		w.WriteHeader(http.StatusAccepted)
	}
}

func TestSSEClient_Success(t *testing.T) {
	writeChan := make(chan string, 10)
	defer close(writeChan)

	server := &mockSSEServer{writeChan: writeChan}
	ts := httptest.NewServer(server)
	defer ts.Close()

	client := NewSSEClient(ts.URL, true, nil, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	if err != nil {
		t.Errorf("Connect failed with error: %v", err)
	}
	require.NoError(t, err)
	defer func() {
		_ = client.Close()
	}()

	// Test ListTools
	tools, err := client.ListTools(ctx)
	require.NoError(t, err)
	require.Len(t, tools, 1)
	assert.Equal(t, "sse_tool", tools[0].Name)

	// Test CallTool
	res, stderr, err := client.CallTool(ctx, "sse_tool", map[string]any{"arg": 123}, nil)
	require.NoError(t, err)
	assert.Empty(t, stderr)
	require.Len(t, res.Content, 1)
	assert.Equal(t, "text", res.Content[0].Type)
	assert.Equal(t, "SSE Success", res.Content[0].Text)

	// Test ListResources
	resources, err := client.ListResources(ctx)
	require.NoError(t, err)
	require.Len(t, resources, 1)
	assert.Equal(t, "file:///etc/sse.conf", resources[0].URI)

	// Test ReadResource
	readRes, _, err := client.ReadResource(ctx, "file:///etc/sse.conf", map[string]string{"X-Test": "1"})
	require.NoError(t, err)
	require.Len(t, readRes.Contents, 1)
	assert.Equal(t, "sse-content", readRes.Contents[0].Text)

	// Test ListPrompts
	prompts, err := client.ListPrompts(ctx)
	require.NoError(t, err)
	require.Len(t, prompts, 1)
	assert.Equal(t, "sse_prompt", prompts[0].Name)

	// Test GetPrompt
	promptRes, _, err := client.GetPrompt(ctx, "sse_prompt", map[string]any{"key": "val"}, map[string]string{"X-Test": "1"})
	require.NoError(t, err)
	require.Len(t, promptRes.Messages, 1)
	assert.Equal(t, "rendered sse prompt", promptRes.Messages[0].Content.Text)
}

func TestSSEClient_FallbackWriteURL(t *testing.T) {
	writeChan := make(chan string, 10)
	defer close(writeChan)

	server := &mockSSEServer{writeChan: writeChan, noEndpoint: true}

	mux := http.NewServeMux()
	mux.Handle("/sse", server)
	mux.Handle("/sse/message", server)

	ts := httptest.NewServer(mux)
	defer ts.Close()

	client := NewSSEClient(ts.URL+"/sse", true, nil, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	require.NoError(t, err)
	defer func() {
		_ = client.Close()
	}()

	assert.Equal(t, ts.URL+"/sse/message", client.writeURL)

	tools, err := client.ListTools(ctx)
	require.NoError(t, err)
	require.Len(t, tools, 1)
	assert.Equal(t, "sse_tool", tools[0].Name)
}

func TestHTTPClient_Success(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		var req Request
		if err := json.Unmarshal(bodyBytes, &req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		var response Response
		response.JSONRPC = "2.0"
		response.ID = req.ID

		switch req.Method {
		case "initialize":
			initResult := map[string]any{
				"protocolVersion": "2024-11-05",
				"capabilities":    map[string]any{},
				"serverInfo": map[string]any{
					"name":    "mock-http-server",
					"version": "1.0.0",
				},
			}
			resBytes, _ := json.Marshal(initResult)
			response.Result = resBytes

		case "tools/list":
			tools := []Tool{
				{
					Name:        "http_tool",
					Description: "HTTP tool",
					InputSchema: swagger.SchemaProperty{
						Type: "object",
					},
				},
			}
			result := map[string]any{
				"tools": tools,
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes

		case "tools/call":
			result := CallToolResult{
				Content: []Content{
					{
						Type: "text",
						Text: "HTTP Success",
					},
				},
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes

		case "resources/list":
			resources := []Resource{
				{
					URI:  "file:///etc/http.conf",
					Name: "http_conf",
				},
			}
			resBytes, _ := json.Marshal(map[string]any{"resources": resources})
			response.Result = resBytes

		case "resources/read":
			result := ReadResourceResult{
				Contents: []ResourceContent{
					{
						URI:  "file:///etc/http.conf",
						Text: "http-content",
					},
				},
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes

		case "prompts/list":
			prompts := []Prompt{
				{
					Name:        "http_prompt",
					Description: "HTTP prompt",
				},
			}
			resBytes, _ := json.Marshal(map[string]any{"prompts": prompts})
			response.Result = resBytes

		case "prompts/get":
			result := GetPromptResult{
				Description: "HTTP prompt description",
				Messages: []PromptMessage{
					{
						Role:    "user",
						Content: PromptContent{Type: "text", Text: "rendered http prompt"},
					},
				},
			}
			resBytes, _ := json.Marshal(result)
			response.Result = resBytes
		}

		respBytes, _ := json.Marshal(response)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(respBytes)
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	client := NewHTTPClient(ts.URL+"/mcp", true, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := client.Connect(ctx)
	require.NoError(t, err)

	tools, err := client.ListTools(ctx)
	require.NoError(t, err)
	require.Len(t, tools, 1)
	assert.Equal(t, "http_tool", tools[0].Name)

	res, stderr, err := client.CallTool(ctx, "http_tool", map[string]any{"x": "y"}, nil)
	require.NoError(t, err)
	assert.Empty(t, stderr)
	require.Len(t, res.Content, 1)
	assert.Equal(t, "HTTP Success", res.Content[0].Text)

	// Test ListResources
	resources, err := client.ListResources(ctx)
	require.NoError(t, err)
	require.Len(t, resources, 1)
	assert.Equal(t, "file:///etc/http.conf", resources[0].URI)

	// Test ReadResource
	readRes, _, err := client.ReadResource(ctx, "file:///etc/http.conf", map[string]string{"X-Test": "1"})
	require.NoError(t, err)
	require.Len(t, readRes.Contents, 1)
	assert.Equal(t, "http-content", readRes.Contents[0].Text)

	// Test ListPrompts
	prompts, err := client.ListPrompts(ctx)
	require.NoError(t, err)
	require.Len(t, prompts, 1)
	assert.Equal(t, "http_prompt", prompts[0].Name)

	// Test GetPrompt
	promptRes, _, err := client.GetPrompt(ctx, "http_prompt", map[string]any{"key": "val"}, map[string]string{"X-Test": "1"})
	require.NoError(t, err)
	require.Len(t, promptRes.Messages, 1)
	assert.Equal(t, "rendered http prompt", promptRes.Messages[0].Content.Text)

	err = client.Close()
	require.NoError(t, err)
}

func TestHTTPClient_Errors(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		var req Request
		_ = json.NewDecoder(r.Body).Decode(&req)

		var resp Response
		resp.JSONRPC = "2.0"
		resp.ID = req.ID

		if req.Method == "initialize" {
			resp.Result = json.RawMessage(`{"protocolVersion":"2024-11-05"}`)
		} else {
			resp.Error = &RPCError{
				Code:    -32600,
				Message: "Simulated error: " + req.Method,
			}
		}

		_ = json.NewEncoder(w).Encode(resp)
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	client := NewHTTPClient(ts.URL+"/mcp", true, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	require.NoError(t, client.Connect(ctx))
	defer func() { _ = client.Close() }()

	_, err := client.ListResources(ctx)
	assert.Error(t, err)

	_, _, err = client.ReadResource(ctx, "file:///test", nil)
	assert.Error(t, err)

	_, err = client.ListPrompts(ctx)
	assert.Error(t, err)

	_, _, err = client.GetPrompt(ctx, "test", nil, nil)
	assert.Error(t, err)
}

func TestHTTPClient_ServerErrors(t *testing.T) {
	// Server returning 500
	tsErr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("internal error"))
	}))
	defer tsErr.Close()

	client := NewHTTPClient(tsErr.URL+"/mcp", true, nil)
	err := client.Connect(context.Background())
	assert.Error(t, err)
}

func TestSSEClient_Errors(t *testing.T) {
	writeChan := make(chan string, 10)
	defer close(writeChan)

	// override handler to return errors for requests
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			_, _ = fmt.Fprint(w, "event: endpoint\ndata: /message\n\n")
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			for {
				select {
				case msg, ok := <-writeChan:
					if !ok {
						return
					}
					_, _ = fmt.Fprintf(w, "event: message\ndata: %s\n\n", msg)
					if flusher, ok := w.(http.Flusher); ok {
						flusher.Flush()
					}
				case <-r.Context().Done():
					return
				}
			}
		}

		var req Request
		_ = json.NewDecoder(r.Body).Decode(&req)

		var resp Response
		resp.JSONRPC = "2.0"
		resp.ID = req.ID

		if req.Method == "initialize" {
			resp.Result = json.RawMessage(`{"protocolVersion":"2024-11-05"}`)
		} else if req.Method == "notifications/initialized" {
			w.WriteHeader(http.StatusAccepted)
			return
		} else {
			resp.Error = &RPCError{
				Code:    -32600,
				Message: "Simulated error: " + req.Method,
			}
		}

		b, _ := json.Marshal(resp)
		writeChan <- string(b)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer ts.Close()

	client := NewSSEClient(ts.URL, true, nil, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	require.NoError(t, client.Connect(ctx))
	defer func() { _ = client.Close() }()

	_, err := client.ListResources(ctx)
	assert.Error(t, err)

	_, _, err = client.ReadResource(ctx, "file:///test", nil)
	assert.Error(t, err)

	_, err = client.ListPrompts(ctx)
	assert.Error(t, err)

	_, _, err = client.GetPrompt(ctx, "test", nil, nil)
	assert.Error(t, err)
}

// An error answer to a request reads only the start of its body into the error: the MCP server
// under test controls it.
func TestSSEClient_ErrorBodyIsCapped(t *testing.T) {
	big := strings.Repeat("x", 1<<20)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			_, _ = fmt.Fprint(w, "event: endpoint\ndata: /message\n\n")
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			<-r.Context().Done()
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(big))
	}))
	defer ts.Close()

	client := NewSSEClient(ts.URL, true, nil, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	defer func() { _ = client.Close() }()

	err := client.Connect(ctx) // the initialize request gets the 500
	require.Error(t, err)
	assert.Contains(t, err.Error(), "status 500")
	assert.Less(t, len(err.Error()), safenet.MaxErrorBodyBytes+256, "the response body is cut")
	// The request carries tool arguments, which may hold secrets: it is not echoed into the error.
	assert.NotContains(t, err.Error(), "jsonrpc")
}

// The HTTP client fails a response past maxResponseBytes instead of parsing a truncated one, and
// cuts an error body.
func TestHTTPClient_BodyIsCapped(t *testing.T) {
	for _, tc := range []struct {
		status  int
		wantErr string
	}{
		{http.StatusOK, "larger than"},
		{http.StatusInternalServerError, "status 500"},
	} {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(strings.Repeat("x", maxResponseBytes+1)))
			}))
			defer ts.Close()
			client := NewHTTPClient(ts.URL+"/mcp", true, nil)
			_, err := client.ListTools(context.Background())
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.wantErr)
			assert.Less(t, len(err.Error()), safenet.MaxErrorBodyBytes+256)
		})
	}
}

// The event stream outlives the per-request timeout: http.Client.Timeout used to cut it after
// 30 s, failing every MCP call of a longer scan.
func TestSSEClient_StreamOutlivesRequestTimeout(t *testing.T) {
	old := sseRequestTimeout
	sseRequestTimeout = 300 * time.Millisecond
	defer func() { sseRequestTimeout = old }()

	writeChan := make(chan string, 10)
	defer close(writeChan)
	ts := httptest.NewServer(&mockSSEServer{writeChan: writeChan})
	defer ts.Close()

	client := NewSSEClient(ts.URL, true, nil, nil)
	require.Zero(t, client.httpClient.Timeout, "an overall timeout would cut the stream")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	require.NoError(t, client.Connect(ctx))
	defer func() { _ = client.Close() }()

	time.Sleep(3 * sseRequestTimeout)
	tools, err := client.ListTools(ctx)
	require.NoError(t, err)
	require.Len(t, tools, 1)
	assert.Equal(t, "sse_tool", tools[0].Name)
}

// With the stream's own timeout gone, a server that never answers must still not hang a caller
// whose ctx has no deadline (the runner's): neither while connecting nor waiting for a response.
func TestSSEClient_BoundedWithoutCallerDeadline(t *testing.T) {
	old := sseRequestTimeout
	sseRequestTimeout = 300 * time.Millisecond
	defer func() { sseRequestTimeout = old }()

	t.Run("no response headers", func(t *testing.T) {
		release := make(chan struct{})
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-release:
			case <-r.Context().Done():
			}
		}))
		defer ts.Close()
		defer close(release)

		start := time.Now()
		err := NewSSEClient(ts.URL, true, nil, nil).Connect(context.Background())
		assert.Error(t, err)
		assert.Less(t, time.Since(start), 5*time.Second)
	})

	t.Run("no response on the stream", func(t *testing.T) {
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodPost {
				w.WriteHeader(http.StatusAccepted) // accepted, never answered
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		}))
		defer ts.Close()

		start := time.Now()
		err := NewSSEClient(ts.URL, true, nil, nil).Connect(context.Background())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no response to initialize")
		assert.Less(t, time.Since(start), 5*time.Second)
	})
}

// The write endpoint the server announces is resolved against the SSE URL itself and must keep
// its origin (scheme, host, port with defaults applied).
func TestSameOriginEndpoint(t *testing.T) {
	base, err := url.Parse("https://mcp.example/sse")
	require.NoError(t, err)
	ok := map[string]string{
		"/messages?session=1":             "https://mcp.example/messages?session=1",
		"messages?session_id=1":           "https://mcp.example/messages?session_id=1",
		"?session=1":                      "https://mcp.example/sse?session=1",
		"https://mcp.example/m":           "https://mcp.example/m",
		"https://mcp.example:443/m?s=abc": "https://mcp.example:443/m?s=abc",
	}
	for ep, want := range ok {
		got, accepted := sameOriginEndpoint(base, ep)
		assert.True(t, accepted, ep)
		assert.Equal(t, want, got, ep)
	}
	for _, ep := range []string{
		"https://evil.example/collect", "//evil.example/collect", "http://mcp.example/message",
		"http://mcp.example:443/message", "https://mcp.example:8443/message",
		"https://mcp.example@evil.example/x", "%zz",
	} {
		_, accepted := sameOriginEndpoint(base, ep)
		assert.False(t, accepted, ep)
	}
}

// A redirect may not carry the client's headers to another origin.
func TestCheckSameOriginRedirect(t *testing.T) {
	first, _ := http.NewRequest(http.MethodPost, "https://mcp.example/messages", nil)
	same, _ := http.NewRequest(http.MethodPost, "https://mcp.example:443/other", nil)
	cross, _ := http.NewRequest(http.MethodPost, "http://evil.example/collect", nil)
	downgrade, _ := http.NewRequest(http.MethodPost, "http://mcp.example/messages", nil)
	assert.NoError(t, checkSameOriginRedirect(same, []*http.Request{first}))
	assert.Error(t, checkSameOriginRedirect(cross, []*http.Request{first}))
	assert.Error(t, checkSameOriginRedirect(downgrade, []*http.Request{first}))

	plain, _ := http.NewRequest(http.MethodGet, "http://mcp.example/sse", nil)
	upgrade, _ := http.NewRequest(http.MethodGet, "https://mcp.example/sse", nil)
	assert.NoError(t, checkSameOriginRedirect(upgrade, []*http.Request{plain}), "http to https on the same host")
	plain8080, _ := http.NewRequest(http.MethodGet, "http://mcp.example:8080/sse", nil)
	otherPort, _ := http.NewRequest(http.MethodGet, "https://mcp.example:9443/collect", nil)
	assert.Error(t, checkSameOriginRedirect(otherPort, []*http.Request{plain8080}), "an upgrade keeps the service's port")
}

// The TLS settings of one client never leak into http.DefaultTransport.
func TestNewSSEClient_DoesNotModifyDefaultTransport(t *testing.T) {
	before := http.DefaultTransport.(*http.Transport).TLSClientConfig
	c := NewSSEClient("https://mcp.example/sse", true, nil, &tls.Config{InsecureSkipVerify: true}) // #nosec G402 -- test
	assert.Same(t, before, http.DefaultTransport.(*http.Transport).TLSClientConfig)
	assert.NotSame(t, http.DefaultTransport, c.httpClient.Transport)
}

// A caller's deadline longer than the client's timeout is honoured: a slow tool call that answers
// within it succeeds.
func TestSSEClient_CallerDeadlineWins(t *testing.T) {
	old := sseRequestTimeout
	sseRequestTimeout = 300 * time.Millisecond
	defer func() { sseRequestTimeout = old }()

	writeChan := make(chan string, 10)
	defer close(writeChan)
	srv := &mockSSEServer{writeChan: writeChan}
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			body, _ := io.ReadAll(r.Body)
			if strings.Contains(string(body), `"tools/list"`) {
				time.Sleep(600 * time.Millisecond) // past the client's timeout, within the caller's
			}
			r.Body = io.NopCloser(strings.NewReader(string(body)))
		}
		srv.ServeHTTP(w, r)
	})
	ts := httptest.NewServer(slow)
	defer ts.Close()

	client := NewSSEClient(ts.URL, true, nil, nil)
	require.NoError(t, client.Connect(context.Background()))
	defer func() { _ = client.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tools, err := client.ListTools(ctx)
	require.NoError(t, err)
	require.Len(t, tools, 1)
}

// Once the server drops the stream, calls fail at once instead of waiting for a response.
func TestSSEClient_FailsFastAfterStreamEnds(t *testing.T) {
	writeChan := make(chan string, 10)
	srv := &mockSSEServer{writeChan: writeChan}
	ts := httptest.NewServer(srv)
	defer ts.Close()

	client := NewSSEClient(ts.URL, true, nil, nil)
	require.NoError(t, client.Connect(context.Background()))
	defer func() { _ = client.Close() }()

	close(writeChan) // the server ends the stream
	require.Eventually(t, func() bool {
		client.pendingMu.Lock()
		defer client.pendingMu.Unlock()
		return client.streamEnded
	}, 5*time.Second, 10*time.Millisecond)

	start := time.Now()
	_, err := client.ListTools(context.Background())
	assert.ErrorIs(t, err, io.ErrClosedPipe)
	assert.Less(t, time.Since(start), time.Second)
}

// An announced endpoint off the stream's origin fails Connect with the reason, rather than
// falling back to a URL without the server's session id.
func TestSSEClient_RejectsForeignEndpoint(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "event: endpoint\ndata: https://evil.example/collect?session=1\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer ts.Close()

	err := NewSSEClient(ts.URL, true, nil, nil).Connect(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "evil.example")
}
