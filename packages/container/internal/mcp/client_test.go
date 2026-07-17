package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/swagger"
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
	assert.Equal(t, "get_weather", tools[0].Name)

	// Test CallTool
	res, stderr, err := client.CallTool(ctx, "get_weather", map[string]any{"city": "Paris"})
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
	res, stderr, err := client.CallTool(ctx, "crash", nil)
	assert.Error(t, err)
	assert.Nil(t, res)
	assert.Contains(t, stderr, "crashing process")
	assert.Contains(t, err.Error(), "exit status 42")
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

	client := NewSSEClient(ts.URL)
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
	res, stderr, err := client.CallTool(ctx, "sse_tool", map[string]any{"arg": 123})
	require.NoError(t, err)
	assert.Empty(t, stderr)
	require.Len(t, res.Content, 1)
	assert.Equal(t, "text", res.Content[0].Type)
	assert.Equal(t, "SSE Success", res.Content[0].Text)
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

	client := NewSSEClient(ts.URL + "/sse")
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
