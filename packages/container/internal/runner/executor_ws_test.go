// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"nhooyr.io/websocket"

	"swazz-engine/internal/swagger"
)

// The WebSocket executor's success path had no coverage: the only test aimed at a
// closed port and asserted the dial error, and the sole live target (demo/ws) had
// not compiled since it was added. These tests drive the executor against an
// in-process target so the handshake, the message exchange and the analyzer chain
// are all exercised without needing an external service.

// newWSTarget starts an httptest server that accepts one WebSocket connection,
// reads a single message and hands it to handle, which decides how to answer.
func newWSTarget(t *testing.T, handle func(ctx context.Context, c *websocket.Conn, msg []byte)) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()

		_, msg, err := c.Read(r.Context())
		if err != nil {
			return
		}
		handle(r.Context(), c, msg)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// wsURL turns the httptest http:// origin into the ws:// form the executor routes on.
func wsURL(srv *httptest.Server) string {
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

func newWSRunner() *Runner {
	return &Runner{config: &swagger.Config{}}
}

func findingRuleIDs(res *swagger.FuzzResult) []string {
	ids := make([]string, 0, len(res.AnalyzerFindings))
	for _, f := range res.AnalyzerFindings {
		ids = append(ids, f.RuleID)
	}
	return ids
}

// A target that answers normally must not be reported as a finding. Without this
// control the leak assertions below would also pass against an analyzer that
// flagged everything.
func TestExecuteWebSocketRequest_HealthyTargetYieldsNoWSFindings(t *testing.T) {
	srv := newWSTarget(t, func(ctx context.Context, c *websocket.Conn, _ []byte) {
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"status":"updated"}`))
		c.Close(websocket.StatusNormalClosure, "")
	})

	r := newWSRunner()
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(srv), "/ws", "/ws",
		map[string]any{"action": "update", "id": 1},
		swagger.ProfileRandom, nil, nil,
	)

	require.Empty(t, res.Error)
	assert.Equal(t, "WS", res.Method)
	assert.Equal(t, http.StatusOK, res.Status)
	// A JSON answer is decoded rather than kept as text.
	assert.Equal(t, map[string]any{"status": "updated"}, res.ResponseBody)

	for _, id := range findingRuleIDs(res) {
		assert.False(t, strings.HasPrefix(id, "swazz/ws-"), "healthy exchange produced %s", id)
	}
}

// The shape demo/ws exposes: the target answers with a panic and its stack before
// closing. The client reads that message, so the exchange completes with 200 and
// the leak is caught from the body rather than from the close code.
func TestExecuteWebSocketRequest_PanicInResponseIsDetected(t *testing.T) {
	srv := newWSTarget(t, func(ctx context.Context, c *websocket.Conn, _ []byte) {
		_ = c.Write(ctx, websocket.MessageText,
			[]byte("panic: index out of range\n\ngoroutine 1 [running]:\nmain.handler(0x0)\n\t/app/main.go:87 +0x1a4"))
		c.Close(websocket.StatusInternalError, "internal error")
	})

	r := newWSRunner()
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(srv), "/ws", "/ws",
		map[string]any{"action": "update", "id": -1},
		swagger.ProfileRandom, nil, nil,
	)

	require.Empty(t, res.Error)
	assert.Equal(t, http.StatusOK, res.Status)
	assert.Contains(t, res.ResponseBody, "panic:")
	assert.Contains(t, findingRuleIDs(res), "swazz/ws-internal-error-leak")
}

// A target that drops the connection with an internal-error close code and no
// message: the read fails, the close code maps to 500 and the crash rule fires.
func TestExecuteWebSocketRequest_InternalErrorCloseIsDetected(t *testing.T) {
	srv := newWSTarget(t, func(_ context.Context, c *websocket.Conn, _ []byte) {
		c.Close(websocket.StatusInternalError, "internal error")
	})

	r := newWSRunner()
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(srv), "/ws", "/ws",
		map[string]any{"action": "update", "id": -1},
		swagger.ProfileRandom, nil, nil,
	)

	assert.Equal(t, http.StatusInternalServerError, res.Status)
	assert.NotEmpty(t, res.Error, "a closed connection must surface an error")
	assert.Contains(t, findingRuleIDs(res), "swazz/ws-crash-detected")
}

// Headers reach the target: the executor merges generated headers with the
// config's global ones, and both have to survive into the handshake request.
func TestExecuteWebSocketRequest_SendsMergedHeaders(t *testing.T) {
	seen := make(chan http.Header, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen <- r.Header.Clone()
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		if _, _, err := c.Read(r.Context()); err != nil {
			return
		}
		_ = c.Write(r.Context(), websocket.MessageText, []byte(`{}`))
		c.Close(websocket.StatusNormalClosure, "")
	}))
	t.Cleanup(srv.Close)

	r := &Runner{config: &swagger.Config{GlobalHeaders: map[string]string{"X-Global": "g"}}}
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(srv), "/ws", "/ws",
		map[string]any{"ping": true},
		swagger.ProfileRandom, nil, map[string]string{"X-Generated": "gen"},
	)

	require.Empty(t, res.Error)
	h := <-seen
	assert.Equal(t, "gen", h.Get("X-Generated"))
	assert.Equal(t, "g", h.Get("X-Global"))
	assert.Equal(t, "gen", res.RequestHeaders["X-Generated"])
}
