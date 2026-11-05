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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"nhooyr.io/websocket"

	"swazz-engine/internal/analyzer"
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

// newWSRunner returns a runner that may reach the in-process (loopback) targets.
func newWSRunner() *Runner {
	return &Runner{
		config: &swagger.Config{
			Security: swagger.SecurityConfig{AllowPrivateIPs: true},
			Settings: swagger.Settings{AnalyzeResponseBody: true},
		},
		analyzer:      analyzer.NewRegistry(nil),
		sizeBaselines: &sync.Map{},
		timeBaselines: &sync.Map{},
	}
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
		context.Background(), wsURL(srv), "/ws", "/ws", "WS",
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
		context.Background(), wsURL(srv), "/ws", "/ws", "WS",
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
		context.Background(), wsURL(srv), "/ws", "/ws", "WS",
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

	r := &Runner{config: &swagger.Config{
		GlobalHeaders: map[string]string{"X-Global": "g"},
		Security:      swagger.SecurityConfig{AllowPrivateIPs: true},
	}, analyzer: analyzer.NewRegistry(nil)}
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(srv), "/ws", "/ws", "WS",
		map[string]any{"ping": true},
		swagger.ProfileRandom, nil, map[string]string{"X-Generated": "gen"},
	)

	require.Empty(t, res.Error)
	h := <-seen
	assert.Equal(t, "gen", h.Get("X-Generated"))
	assert.Equal(t, "g", h.Get("X-Global"))
	assert.Equal(t, "gen", res.RequestHeaders["X-Generated"])
}

// A scan that may not reach private addresses (the default, and what the coordinator forces on
// shared runners) must not reach a loopback WebSocket target either: only the HTTP executor
// enforced it before.
func TestExecuteWebSocketRequest_BlocksPrivateTarget(t *testing.T) {
	var hits atomic.Int32
	srv := newWSTarget(t, func(ctx context.Context, c *websocket.Conn, msg []byte) {
		hits.Add(1)
		_ = c.Write(ctx, websocket.MessageText, msg)
	})

	r := &Runner{config: &swagger.Config{}, analyzer: analyzer.NewRegistry(nil)}
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(srv), "/ws", "/ws", "WS",
		map[string]any{"ping": true}, swagger.ProfileRandom, nil, nil,
	)

	assert.Contains(t, res.Error, "SSRF policy")
	assert.Zero(t, res.Status, "a blocked target never answered: no status, not a 5xx finding")
	assert.Zero(t, hits.Load(), "the blocked target must not be contacted")
}

// Exchanges with the same endpoint run in parallel: the target below answers only once all of
// them are connected at the same time.
func TestExecuteWebSocketRequest_SameEndpointRunsInParallel(t *testing.T) {
	const n = 4
	var open atomic.Int32
	all := make(chan struct{})
	srv := newWSTarget(t, func(ctx context.Context, c *websocket.Conn, msg []byte) {
		if open.Add(1) == n {
			close(all)
		}
		select {
		case <-all:
		case <-time.After(10 * time.Second): // a hijacked request's context never ends
			return
		}
		_ = c.Write(ctx, websocket.MessageText, msg)
		c.Close(websocket.StatusNormalClosure, "")
	})

	r := newWSRunner()
	r.config.Settings.TimeoutMs = 5000
	var wg sync.WaitGroup
	results := make([]*swagger.FuzzResult, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i] = r.executeWebSocketRequest(context.Background(), wsURL(srv), "/ws", "/ws", "WS",
				map[string]any{"i": i}, swagger.ProfileRandom, nil, nil)
		}()
	}
	wg.Wait()
	for _, res := range results {
		require.NotNil(t, res)
		assert.Empty(t, res.Error)
		assert.Equal(t, http.StatusOK, res.Status)
	}
}

// With response analysis off, the answer's body is not analysed, as an HTTP, gRPC or MCP one is
// not; the close code still is: a crash is a transport finding, not a body one.
func TestExecuteWebSocketRequest_BodyNotAnalysedWhenDisabled(t *testing.T) {
	srv := newWSTarget(t, func(ctx context.Context, c *websocket.Conn, _ []byte) {
		_ = c.Write(ctx, websocket.MessageText,
			[]byte("panic: index out of range\n\ngoroutine 1 [running]:\nmain.handler(0x0)\n\t/app/main.go:87 +0x1a4"))
		c.Close(websocket.StatusInternalError, "internal error")
	})
	crash := newWSTarget(t, func(_ context.Context, c *websocket.Conn, _ []byte) {
		c.Close(websocket.StatusInternalError, "internal error")
	})

	r := newWSRunner()
	r.config.Settings.AnalyzeResponseBody = false
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(srv), "/ws", "/ws", "WS",
		map[string]any{"action": "update"},
		swagger.ProfileRandom, nil, nil,
	)
	assert.NotContains(t, findingRuleIDs(res), "swazz/ws-internal-error-leak")

	res = r.executeWebSocketRequest(
		context.Background(), wsURL(crash), "/ws", "/ws", "WS",
		map[string]any{"action": "update"},
		swagger.ProfileRandom, nil, nil,
	)
	assert.Contains(t, findingRuleIDs(res), "swazz/ws-crash-detected")
}

// A slow answer is compared with the endpoint's time baseline; an exchange that timed out is not,
// since a target that ignores a message says nothing about how long it takes to answer one.
func TestExecuteWebSocketRequest_TimeBaseline(t *testing.T) {
	slow := newWSTarget(t, func(ctx context.Context, c *websocket.Conn, _ []byte) {
		time.Sleep(400 * time.Millisecond)
		_ = c.Write(ctx, websocket.MessageText, []byte("ok"))
		c.Close(websocket.StatusNormalClosure, "")
	})
	silent := newWSTarget(t, func(_ context.Context, _ *websocket.Conn, _ []byte) {
		time.Sleep(700 * time.Millisecond) // past the 400ms exchange timeout, then gone
	})

	r := newWSRunner()
	r.config.Settings.TimeAnomalyThresholdMs = 200
	r.config.Settings.TimeoutMs = 3000
	for range 5 {
		r.recordTimeBaseline("WS", "/ws", 5)
	}
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(slow), "/ws", "/ws", "WS",
		"' OR SLEEP(5)--", swagger.ProfileMalicious, nil, nil,
	)
	slowIDs := findingRuleIDs(res)

	r.config.Settings.TimeoutMs = 400
	res = r.executeWebSocketRequest(
		context.Background(), wsURL(silent), "/ws", "/ws", "WS",
		"' OR SLEEP(5)--", swagger.ProfileMalicious, nil, nil,
	)
	require.NotEmpty(t, res.Error, "the silent target times out")
	for _, id := range findingRuleIDs(res) {
		assert.NotContains(t, id, "time-based", "a timed-out exchange was reported as a timing finding")
	}
	assert.Condition(t, func() bool {
		for _, id := range slowIDs {
			if strings.Contains(id, "time-based") {
				return true
			}
		}
		return false
	}, "a slow answer to a timing payload is reported: %v", slowIDs)
}

// A malicious payload whose answer is far larger than the endpoint's usual one is flagged against
// the size baseline the RANDOM profile recorded under the endpoint's method and path.
func TestExecuteWebSocketRequest_ResponseSizeAnomalyAgainstBaseline(t *testing.T) {
	big := strings.Repeat("x", 20_000)
	srv := newWSTarget(t, func(ctx context.Context, c *websocket.Conn, _ []byte) {
		_ = c.Write(ctx, websocket.MessageText, []byte(big))
		c.Close(websocket.StatusNormalClosure, "")
	})

	r := newWSRunner()
	for range 5 {
		r.recordSizeBaseline("WS", "/ws", 500)
	}
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(srv), "/ws", "/ws", "WS",
		map[string]any{"q": "<script>"},
		swagger.ProfileMalicious, nil, nil,
	)

	require.Empty(t, res.Error)
	assert.Contains(t, findingRuleIDs(res), "swazz/response-size-anomaly")
}

// The payload checks see what was sent: a reflected script tag in a WebSocket answer is reported.
func TestExecuteWebSocketRequest_ReflectedPayloadIsDetected(t *testing.T) {
	srv := newWSTarget(t, func(ctx context.Context, c *websocket.Conn, msg []byte) {
		_ = c.Write(ctx, websocket.MessageText, []byte("<html>you said "+string(msg)+"</html>"))
		c.Close(websocket.StatusNormalClosure, "")
	})

	r := newWSRunner()
	res := r.executeWebSocketRequest(
		context.Background(), wsURL(srv), "/ws", "/ws", "WS",
		"<script>alert(1)</script>", swagger.ProfileMalicious, nil, nil,
	)

	require.Empty(t, res.Error)
	assert.Contains(t, findingRuleIDs(res), "swazz/reflected-xss")
}
