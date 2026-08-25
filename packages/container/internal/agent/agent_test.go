// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"swazz-engine/internal/config"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
	"swazz-engine/internal/triage"
)

func TestInferOOBServerURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{
			input:    "wss://swazz.secmy.app/api/runners/connect",
			expected: "https://swazz.secmy.app",
		},
		{
			input:    "ws://localhost:8080/api/runners/connect",
			expected: "http://localhost:8080",
		},
		{
			input:    "wss://swazz.secmy.app/api/scans",
			expected: "https://swazz.secmy.app",
		},
		{
			input:    "https://swazz.secmy.app",
			expected: "https://swazz.secmy.app",
		},
		{
			input:    "",
			expected: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			actual := inferOOBServerURL(tc.input)
			assert.Equal(t, tc.expected, actual)
		})
	}
}

func TestDeriveTelemetryURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{
			input:    "wss://swazz.secmy.app/api/runners/connect",
			expected: "https://swazz.secmy.app/api/telemetry/scans/increment",
		},
		{
			input:    "ws://localhost:8080/api/runners/connect",
			expected: "http://localhost:8080/api/telemetry/scans/increment",
		},
		{
			input:    "http://example.com",
			expected: "http://example.com/api/telemetry/scans/increment",
		},
		{
			input:    "",
			expected: "https://swazz.secmy.app/api/telemetry/scans/increment",
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			actual := deriveTelemetryURL(tc.input)
			assert.Equal(t, tc.expected, actual)
		})
	}
}

func TestIncrementGlobalScanTelemetry(t *testing.T) {
	calledChan := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
		assert.Equal(t, "Swazz/1.0 (+https://github.com/SecH0us3/swazz)", r.Header.Get("User-Agent"))
		w.WriteHeader(http.StatusOK)
		select {
		case calledChan <- struct{}{}:
		default:
		}
	}))
	defer server.Close()

	// Test case 1: disableTelemetry = true
	IncrementGlobalScanTelemetry(server.URL, true)
	select {
	case <-calledChan:
		t.Fatal("telemetry should have been disabled")
	case <-time.After(50 * time.Millisecond):
		// Expected: no call
	}

	// Test case 2: disableTelemetry = false
	IncrementGlobalScanTelemetry(server.URL, false)
	select {
	case <-calledChan:
		time.Sleep(50 * time.Millisecond)
	case <-time.After(1 * time.Second):
		t.Fatal("timeout waiting for telemetry increment call")
	}
}

func TestAgent_GRPCAndProtoDetection(t *testing.T) {
	protoBytes := []byte("syntax = \"proto3\";\npackage test;\nmessage M { string a = 1; }")
	assert.True(t, swagger.IsProtoFile(protoBytes))
	assert.True(t, swagger.IsGRPCURL("grpc://localhost:50051"))
	assert.True(t, swagger.IsGRPCURL("grpcs://10.0.0.1:443"))
	assert.False(t, swagger.IsGRPCURL("http://localhost:8080"))
	assert.False(t, swagger.IsGRPCURL("https://api.example.com"))
}

func TestFilterSensitiveData(t *testing.T) {
	raw := `{"password": "secret123", "token": "jwt-token-456", "safe": "value"}`
	filtered := filterSensitiveData(raw)
	assert.NotContains(t, filtered, "password")
	assert.NotContains(t, filtered, "secret")
	assert.NotContains(t, filtered, "token")
	assert.Contains(t, filtered, "[FILTERED]")
	assert.Contains(t, filtered, "safe")
}

func TestPruneSchema(t *testing.T) {
	// 1. Nil safety
	pruneSchema(nil, 0, 3)

	// 2. Deeply nested schema
	schema := &swagger.SchemaProperty{
		Type: "object",
		Properties: map[string]*swagger.SchemaProperty{
			"level1": {
				Type: "object",
				Properties: map[string]*swagger.SchemaProperty{
					"level2": {
						Type: "object",
						Properties: map[string]*swagger.SchemaProperty{
							"level3": {Type: "string"},
						},
					},
				},
			},
		},
	}

	pruneSchema(schema, 0, 1)
	assert.Nil(t, schema.Properties["level1"].Properties)
}

func TestLoadPrivateKey(t *testing.T) {
	// 1. Valid 32-byte seed in hex
	seedHex := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	key, err := loadPrivateKey(seedHex)
	assert.NoError(t, err)
	assert.NotNil(t, key)

	// 2. From file
	tmpDir := t.TempDir()
	keyFile := tmpDir + "/key.hex"
	require.NoError(t, os.WriteFile(keyFile, []byte(seedHex+"\n"), 0600))
	keyFromFile, err := loadPrivateKey(keyFile)
	assert.NoError(t, err)
	assert.Equal(t, key, keyFromFile)

	// 3. Invalid hex
	_, err = loadPrivateKey("not-hex-string")
	assert.Error(t, err)

	// 4. Invalid key size
	_, err = loadPrivateKey("0123456789abcdef")
	assert.Error(t, err)
}

func TestDeriveHTTPBaseURL(t *testing.T) {
	assert.Equal(t, "https://swazz.secmy.app", deriveHTTPBaseURL("wss://swazz.secmy.app/api/runners/connect"))
	assert.Equal(t, "http://localhost:8080", deriveHTTPBaseURL("ws://localhost:8080/api/runners/connect"))
	assert.Equal(t, "https://api.example.com", deriveHTTPBaseURL("https://api.example.com/api/scans"))
	assert.Equal(t, "https://api.example.com/sub", deriveHTTPBaseURL("https://api.example.com/sub"))
	assert.Equal(t, "", deriveHTTPBaseURL(""))
}

func TestLoggingHelpers(t *testing.T) {
	// ensure no panics
	logDebug("test %s", "debug")
	logInfo("test %s", "info")
	logWarn("test %s", "warn")
	logError("test %s", "error")
}

func TestSendTriageBatchToEdge(t *testing.T) {
	// 1. Empty results
	assert.Nil(t, sendTriageBatchToEdge("http://localhost:8080", "token", "scan1", nil))

	// 2. Invalid coordinator URL
	err := sendTriageBatchToEdge("", "token", "scan1", []*triage.TriageResult{{FindingIDs: []string{"f1"}}})
	assert.Error(t, err)

	// 3. Successful patch
	var receivedPatch map[string]interface{}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "PATCH", r.Method)
		assert.Equal(t, "/api/scans/scan1/findings/ai-triage", r.URL.Path)
		assert.Equal(t, "Bearer test-token", r.Header.Get("Authorization"))
		_ = json.NewDecoder(r.Body).Decode(&receivedPatch)
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	trueVal := true
	results := []*triage.TriageResult{
		{
			FindingIDs:    []string{"f1", "f2"},
			AIStatus:      "completed",
			AIRelevance:   &trueVal,
			AIExplanation: "Real vulnerability verified",
			AIConfidence:  95,
		},
	}
	err = sendTriageBatchToEdge(ts.URL, "test-token", "scan1", results)
	assert.NoError(t, err)
	assert.NotNil(t, receivedPatch["updates"])

	// 4. Server error
	tsErr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("internal database error"))
	}))
	defer tsErr.Close()

	err = sendTriageBatchToEdge(tsErr.URL, "test-token", "scan1", results)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "Edge API batch triage error")
}

func TestRunAgentConnection_HandshakeAndParseRequest(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	pubHex := hex.EncodeToString(pub)

	doneCh := make(chan struct{})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			Subprotocols: []string{"swazz-agent"},
		})
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")

		ctx := r.Context()

		// 1. Send challenge
		err = wsjson.Write(ctx, c, map[string]string{
			"type":  "challenge",
			"nonce": "test_nonce_12345",
		})
		if err != nil {
			return
		}

		// 2. Read challenge_response
		var resp struct {
			Type      string `json:"type"`
			Signature string `json:"signature"`
		}
		if err := wsjson.Read(ctx, c, &resp); err != nil {
			return
		}
		assert.Equal(t, "challenge_response", resp.Type)

		// 3. Send auth_ok
		if err := wsjson.Write(ctx, c, map[string]string{"type": "auth_ok"}); err != nil {
			return
		}

		// 4. Send parse_request
		rawSpec := `{"openapi":"3.0.0","info":{"title":"Demo","version":"1.0"},"paths":{"/hello":{"get":{"responses":{"200":{"description":"ok"}}}}}}`
		reqBytes, _ := json.Marshal(map[string]string{
			"rawSpec": rawSpec,
		})
		if err := wsjson.Write(ctx, c, map[string]interface{}{
			"type":    "parse_request",
			"reqId":   "req_test_1",
			"payload": json.RawMessage(reqBytes),
		}); err != nil {
			return
		}

		// 5. Read parse_result
		var parseResp struct {
			Type    string                 `json:"type"`
			ReqID   string                 `json:"reqId"`
			Payload map[string]interface{} `json:"payload"`
		}
		if err := wsjson.Read(ctx, c, &parseResp); err != nil {
			return
		}
		assert.Equal(t, "parse_result", parseResp.Type)
		assert.Equal(t, "req_test_1", parseResp.ReqID)
		assert.NotNil(t, parseResp.Payload["endpoints"])

		// 6. Send oob_trigger and job_command with nonexistent run to verify handling
		oobBytes, _ := json.Marshal(map[string]string{"runId": "nonexistent", "uuid": "uuid123"})
		_ = wsjson.Write(ctx, c, map[string]interface{}{
			"type":    "oob_trigger",
			"payload": json.RawMessage(oobBytes),
		})

		cmdBytes, _ := json.Marshal(map[string]string{"runId": "nonexistent", "command": "pause"})
		_ = wsjson.Write(ctx, c, map[string]interface{}{
			"type":    "job_command",
			"payload": json.RawMessage(cmdBytes),
		})

		close(doneCh)
	}))
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	agentDone := make(chan struct{})
	go func() {
		defer close(agentDone)
		_ = runAgentConnection(
			ctx,
			wsURL,
			&websocket.DialOptions{Subprotocols: []string{"swazz-agent"}},
			ts.URL,
			"",
			"test-runner",
			true,
			priv,
			pubHex,
			true,
		)
	}()

	select {
	case <-doneCh:
		cancel()
	case <-time.After(5 * time.Second):
		cancel()
		t.Fatal("timed out waiting for handshake and parse request")
	}

	<-agentDone
}

func TestRunAgentConnection_AuthFailures(t *testing.T) {
	// 1. Server returns 401 Unauthorized
	ts401 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer ts401.Close()

	wsURL := "ws" + strings.TrimPrefix(ts401.URL, "http")
	err := runAgentConnection(
		context.Background(),
		wsURL,
		nil,
		ts401.URL,
		"invalid-token",
		"runner",
		false,
		nil,
		"",
		true,
	)
	assert.ErrorIs(t, err, errAgentAuthFatal)

	// 2. Handshake returns auth_failed
	pub, priv, _ := ed25519.GenerateKey(nil)
	tsFailed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")
		_ = wsjson.Write(r.Context(), c, map[string]string{"type": "challenge", "nonce": "n1"})
		var resp map[string]string
		_ = wsjson.Read(r.Context(), c, &resp)
		_ = wsjson.Write(r.Context(), c, map[string]string{"type": "auth_error", "error": "signature invalid"})
	}))
	defer tsFailed.Close()

	wsURLFailed := "ws" + strings.TrimPrefix(tsFailed.URL, "http")
	err = runAgentConnection(
		context.Background(),
		wsURLFailed,
		nil,
		tsFailed.URL,
		"",
		"runner",
		true,
		priv,
		hex.EncodeToString(pub),
		true,
	)
	assert.ErrorIs(t, err, errAgentAuthFatal)
}

func TestRunAgentConnection_JobDispatch(t *testing.T) {
	safenet.AllowLocalNetwork = true
	defer func() {
		safenet.AllowLocalNetwork = false
	}()

	// 1. Target HTTP server for runner
	targetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer targetServer.Close()

	pub, priv, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	pubHex := hex.EncodeToString(pub)

	t.Setenv("SWAZZ_DISABLE_TELEMETRY", "true")
	jobDoneCh := make(chan struct{})

	// 2. Coordinator WebSocket server
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") != "websocket" {
			w.WriteHeader(http.StatusOK)
			return
		}
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			Subprotocols: []string{"swazz-agent"},
		})
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")

		ctx := r.Context()

		// Handshake
		_ = wsjson.Write(ctx, c, map[string]string{"type": "challenge", "nonce": "nonce_job_123"})
		var challengeResp struct{ Signature string }
		_ = wsjson.Read(ctx, c, &challengeResp)
		_ = wsjson.Write(ctx, c, map[string]string{"type": "auth_ok"})

		// Send job_dispatch
		dispatchPayload := JobDispatchPayload{
			RunID: "run_test_job_1",
			Config: config.CliConfig{
				BaseURL:  targetServer.URL,
				Security: swagger.SecurityConfig{AllowPrivateIPs: true},
				EndpointDefinitions: []swagger.EndpointConfig{
					{
						Path:   "/api/health",
						Method: "GET",
					},
				},
				Settings: swagger.Settings{
					IterationsPerProfile: 1,
					Concurrency:          1,
					Profiles:             []swagger.FuzzingProfile{swagger.ProfileRandom},
					TimeoutMs:            500,
				},
			},
		}
		dispatchBytes, _ := json.Marshal(dispatchPayload)
		_ = wsjson.Write(ctx, c, map[string]interface{}{
			"type":    "job_dispatch",
			"payload": json.RawMessage(dispatchBytes),
		})

		// Read events until complete or timeout
		for {
			var eventMsg struct {
				Type    string `json:"type"`
				RunID   string `json:"runId"`
				Payload struct {
					Type string          `json:"type"`
					Data json.RawMessage `json:"data"`
				} `json:"payload"`
			}
			if err := wsjson.Read(ctx, c, &eventMsg); err != nil {
				t.Logf("Server wsjson.Read err: %v", err)
				break
			}
			t.Logf("Server received WS event: Type=%s, Payload.Type=%s", eventMsg.Type, eventMsg.Payload.Type)
			if eventMsg.Payload.Type == "complete" || eventMsg.Type == "error" {
				break
			}
		}

		close(jobDoneCh)
	}))
	defer ts.Close()

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	agentDone := make(chan struct{})
	go func() {
		defer close(agentDone)
		_ = runAgentConnection(
			ctx,
			wsURL,
			&websocket.DialOptions{Subprotocols: []string{"swazz-agent"}},
			ts.URL,
			"",
			"test-runner",
			true,
			priv,
			pubHex,
			true,
		)
	}()

	select {
	case <-jobDoneCh:
		cancel()
	case <-time.After(30 * time.Second):
		cancel()
		t.Fatal("timed out waiting for job_dispatch completion")
	}

	<-agentDone
}



