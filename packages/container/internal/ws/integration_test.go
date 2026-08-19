// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ws_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime/debug"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"nhooyr.io/websocket"

	swazzWs "swazz-engine/internal/ws"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/swagger"
)

func wsHandler(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return
	}
	defer c.Close(websocket.StatusNormalClosure, "")

	for {
		typ, msg, err := c.Read(r.Context())
		if err != nil {
			break
		}

		if typ != websocket.MessageText {
			continue
		}

		var req map[string]interface{}
		if err := json.Unmarshal(msg, &req); err != nil {
			if string(msg) == "crash" {
				c.Close(websocket.StatusInternalError, "simulated crash")
				c.Close(websocket.StatusAbnormalClosure, "")
				return
			}
			continue
		}

		action, _ := req["action"].(string)

		switch action {
		case "search", "query":
			query, _ := req["query"].(string)
			if strings.ContainsAny(query, "'\";-") {
				resp := map[string]string{
					"error": "You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near '" + query + "'",
				}
				b, _ := json.Marshal(resp)
				c.Write(r.Context(), websocket.MessageText, b)
			} else {
				c.Write(r.Context(), websocket.MessageText, []byte(`{"result": "ok"}`))
			}

		case "update", "user":
			id, _ := req["id"].(float64)
			if id <= 0 {
				func() {
					defer func() {
						if rec := recover(); rec != nil {
							errStr := fmt.Sprintf("panic: index out of range\n%s", debug.Stack())
							c.Write(r.Context(), websocket.MessageText, []byte(errStr))
							c.Close(websocket.StatusInternalError, "internal error")
						}
					}()
					panic("simulated panic on update")
				}()
				return
			} else {
				c.Write(r.Context(), websocket.MessageText, []byte(`{"status": "updated"}`))
			}

		case "exec_diag":
			query, _ := req["query"].(string)
			cmd, _ := req["cmd"].(string)
			payload, _ := req["payload"].(map[string]interface{})
			if cmd == "" && query != "" {
				cmd = query
			}
			if cmd == "" && payload != nil {
				if c, ok := payload["cmd"].(string); ok && c != "" {
					cmd = c
				}
			}
			if strings.ContainsAny(cmd, "|;&$`") || strings.Contains(cmd, "id") || strings.Contains(cmd, "whoami") || strings.Contains(cmd, "cat") || strings.Contains(cmd, "ping") || cmd != "" {
				resp := map[string]string{
					"output": "uid=0(root) gid=0(root) groups=0(root)",
				}
				b, _ := json.Marshal(resp)
				c.Write(r.Context(), websocket.MessageText, b)
			} else {
				c.Write(r.Context(), websocket.MessageText, []byte(`{"output": "diag done"}`))
			}

		case "get_config":
			resp := map[string]string{
				"api_key": "AKIAIOSFODNN7EXAMPLE",
			}
			b, _ := json.Marshal(resp)
			c.Write(r.Context(), websocket.MessageText, b)

		case "crash":
			return
			
		default:
			c.Write(r.Context(), websocket.MessageText, []byte(`{"error": "unknown action"}`))
		}
	}
}

func startVulnerableDemoServer(t *testing.T) (string, func()) {
	server := httptest.NewServer(http.HandlerFunc(wsHandler))
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"
	
	cleanup := func() {
		server.Close()
	}

	return wsURL, cleanup
}

func TestWSIntegration_EndToEnd(t *testing.T) {
	wsURL, cleanupServer := startVulnerableDemoServer(t)
	defer cleanupServer()

	// 1. Test Endpoint discovery
	protoRes, err := swazzWs.SynthesizeWSEndpoint(wsURL)
	require.NoError(t, err)
	require.NotNil(t, protoRes)
	require.Len(t, protoRes.Endpoints, 1)
	
	ep := protoRes.Endpoints[0]
	assert.Equal(t, "WS", ep.Method)
	assert.Equal(t, wsURL, ep.Path)
	
	// 2. Configure full Swazz Fuzzing Runner with RANDOM, BOUNDARY, MALICIOUS profiles
	cfg := &swagger.Config{
		BaseURL:   wsURL,
		Endpoints: protoRes.Endpoints,
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		Settings: swagger.Settings{
			IterationsPerProfile: 200,
			Concurrency:          10,
			Profiles: []swagger.FuzzingProfile{
				swagger.ProfileRandom,
				swagger.ProfileBoundary,
				swagger.ProfileMalicious,
			},
			AnalyzeResponseBody: true,
			TimeoutMs:           5000,
		},
	}

	r := runner.New(cfg, nil)
	require.NotNil(t, r)
	defer r.Close()

	// 3. Subscribe and collect fuzz results
	resultsCh := r.Subscribe()
	var allFuzzResults []*swagger.FuzzResult
	findingsByRule := make(map[string][]swagger.AnalysisFinding)
	var findingsMu sync.Mutex
	done := make(chan struct{})

	go func() {
		for evt := range resultsCh {
			if evt.Type == runner.EventResult {
				if res, ok := evt.Data.(*swagger.FuzzResult); ok {
					findingsMu.Lock()
					allFuzzResults = append(allFuzzResults, res)
					for _, f := range res.AnalyzerFindings {
						findingsByRule[f.RuleID] = append(findingsByRule[f.RuleID], f)
					}
					findingsMu.Unlock()
				}
			}
			if evt.Type == runner.EventComplete {
				break
			}
		}
		close(done)
	}()

	// 4. Execute Fuzzing Run
	runErr := r.Start(context.Background())
	require.NoError(t, runErr)

	select {
	case <-done:
	case <-time.After(60 * time.Second):
		t.Fatal("Timeout waiting for runner EventComplete")
	}
	r.Unsubscribe(resultsCh)

	// 5. Assertions on results and vulnerability findings
	findingsMu.Lock()
	defer findingsMu.Unlock()

	assert.NotEmpty(t, allFuzzResults, "Expected fuzz results from runner execution")

	// Verify swazz/ws-internal-error-leak was detected
	wsInternalFindings := findingsByRule["swazz/ws-internal-error-leak"]
	assert.NotEmpty(t, wsInternalFindings, "Expected finding 'swazz/ws-internal-error-leak' to be captured")

	// Verify swazz/sql-error-leak was detected
	sqliFindings := findingsByRule["swazz/sql-error-leak"]
	assert.NotEmpty(t, sqliFindings, "Expected finding 'swazz/sql-error-leak' (SQLi) to be captured")

	// Verify swazz/cmdi-leak was detected
	cmdiFindings := findingsByRule["swazz/cmdi-leak"]
	assert.NotEmpty(t, cmdiFindings, "Expected finding 'swazz/cmdi-leak' (Command Injection) to be captured")

	// Verify swazz/sensitive-data-leak was detected
	sensitiveFindings := findingsByRule["swazz/sensitive-data-leak"]
	assert.NotEmpty(t, sensitiveFindings, "Expected finding 'swazz/sensitive-data-leak' (Sensitive Data) to be captured")

	t.Logf("Integration test summary: %d results executed, %d unique finding rules detected",
		len(allFuzzResults), len(findingsByRule))
	for ruleID, findings := range findingsByRule {
		t.Logf(" - %s: %d occurrences", ruleID, len(findings))
	}
}
