// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ws

import (
	"context"
	"fmt"
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

	"swazz-engine/internal/security"
)

func TestMapWSCloseCodeToHTTPStatus(t *testing.T) {
	tests := []struct {
		code     websocket.StatusCode
		expected int
	}{
		{websocket.StatusNormalClosure, 200},
		{websocket.StatusProtocolError, 400},
		{websocket.StatusUnsupportedData, 400},
		{websocket.StatusInvalidFramePayloadData, 400},
		{websocket.StatusPolicyViolation, 403},
		{websocket.StatusMessageTooBig, 413},
		{websocket.StatusAbnormalClosure, 500},
		{websocket.StatusInternalError, 500},
		{websocket.StatusCode(4000), 500}, // unknown code
	}
	for _, tc := range tests {
		assert.Equal(t, tc.expected, MapWSCloseCodeToHTTPStatus(tc.code))
	}
}

func TestClient_SendMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusInternalError, "the sky is falling")

		ctx, cancel := context.WithTimeout(r.Context(), time.Second*10)
		defer cancel()

		typ, msg, err := c.Read(ctx)
		if err != nil {
			return
		}

		if string(msg) == "crash" {
			c.Close(websocket.StatusInternalError, "simulated crash")
			return
		}

		c.Write(ctx, typ, msg)
		c.Close(websocket.StatusNormalClosure, "")
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	client := NewClient(true)

	t.Run("success", func(t *testing.T) {
		msg, status, err := client.SendMessage(context.Background(), wsURL, []byte("hello"), nil)
		require.NoError(t, err)
		assert.Equal(t, 200, status)
		assert.Equal(t, "hello", string(msg))
	})

	t.Run("crash returns 500", func(t *testing.T) {
		_, status, err := client.SendMessage(context.Background(), wsURL, []byte("crash"), nil)
		assert.Error(t, err)
		assert.Equal(t, 500, status)
	})

	t.Run("dial error non-existent endpoint", func(t *testing.T) {
		_, status, err := client.SendMessage(context.Background(), "ws://127.0.0.1:1/invalid", []byte("test"), nil)
		assert.Error(t, err)
		assert.NotEqual(t, 200, status)
	})

	t.Run("timeout context", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, status, err := client.SendMessage(ctx, wsURL, []byte("test"), nil)
		assert.Error(t, err)
		assert.NotEqual(t, 200, status)
	})

	t.Run("custom handshake headers", func(t *testing.T) {
		headerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("X-Custom-Auth") != "secret-token-123" {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			c, err := websocket.Accept(w, r, nil)
			if err != nil {
				return
			}
			defer c.Close(websocket.StatusNormalClosure, "")
			ctx, cancel := context.WithTimeout(r.Context(), time.Second*5)
			defer cancel()
			typ, msg, err := c.Read(ctx)
			if err != nil {
				return
			}
			c.Write(ctx, typ, msg)
		}))
		defer headerServer.Close()

		hWsURL := "ws" + strings.TrimPrefix(headerServer.URL, "http")
		headers := map[string]string{"X-Custom-Auth": "secret-token-123"}
		msg, status, err := client.SendMessage(context.Background(), hWsURL, []byte("ping"), headers)
		require.NoError(t, err)
		assert.Equal(t, 200, status)
		assert.Equal(t, "ping", string(msg))
	})
}

// Unless the scan may reach private addresses, the handshake must not reach a loopback target:
// the WebSocket executor goes through the same SSRF check as the HTTP one.
func TestClient_BlocksPrivateAddress(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		typ, msg, err := c.Read(r.Context())
		if err != nil {
			return
		}
		_ = c.Write(r.Context(), typ, msg)
	}))
	defer server.Close()
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, status, err := NewClient(false).SendMessage(ctx, wsURL, []byte("hello"), nil)
	require.ErrorIs(t, err, security.ErrSSRFBlocked)
	assert.Zero(t, status, "a blocked target never answered: no status, not a 5xx finding")
	assert.Zero(t, hits.Load(), "the blocked target must not be contacted")

	msg, status, err := NewClient(true).SendMessage(ctx, wsURL, []byte("hello"), nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, status)
	assert.Equal(t, "hello", string(msg))
	assert.Equal(t, int32(1), hits.Load())
}

// newBarrierWSServer echoes each message only once n connections are open at the same time, so
// it answers only clients that send in parallel.
func newBarrierWSServer(t *testing.T, n int32) *httptest.Server {
	t.Helper()
	var open atomic.Int32
	all := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		if open.Add(1) == n {
			close(all)
		}
		typ, msg, err := c.Read(r.Context())
		if err != nil {
			return
		}
		select {
		case <-all:
		case <-time.After(10 * time.Second): // a hijacked request's context never ends
			return
		}
		_ = c.Write(r.Context(), typ, msg)
		c.Close(websocket.StatusNormalClosure, "")
	}))
	t.Cleanup(srv.Close)
	return srv
}

// One client sends to the same endpoint from several goroutines at once; nothing serializes them.
func TestClient_SendMessage_Concurrent(t *testing.T) {
	const n = 4
	srv := newBarrierWSServer(t, n)
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	client := NewClient(true)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			msg, status, err := client.SendMessage(ctx, wsURL, []byte(fmt.Sprint(i)), nil)
			if err == nil && (status != http.StatusOK || string(msg) != fmt.Sprint(i)) {
				err = fmt.Errorf("got %d %q", status, msg)
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		assert.NoError(t, err)
	}
}

// A target that answers and then ignores the close frame does not hold the exchange past its
// context: the library alone would wait seconds for the peer's close frame.
func TestClient_SendMessage_CloseIsBoundedByTheContext(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		_, msg, err := c.Read(context.Background())
		if err != nil {
			return
		}
		_ = c.Write(context.Background(), websocket.MessageText, msg)
		<-release // never reads the client's close frame
	}))
	t.Cleanup(func() {
		close(release)
		srv.Close()
	})

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	msg, status, err := NewClient(true).SendMessage(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), []byte("hi"), nil)
	require.NoError(t, err)
	assert.Equal(t, 200, status)
	assert.Equal(t, "hi", string(msg))
	assert.Less(t, time.Since(start), 2*time.Second)
}

// Nothing answered the handshake: a network error (status 0), not a 5xx of the target.
func TestClient_SendMessage_RefusedIsNotA5xx(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, status, err := NewClient(true).SendMessage(ctx, url, []byte("hi"), nil)
	require.Error(t, err)
	assert.Zero(t, status)
}
