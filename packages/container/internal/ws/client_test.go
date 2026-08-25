// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ws

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"nhooyr.io/websocket"
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

	client := NewClient()

	t.Run("close nil", func(t *testing.T) {
		assert.NoError(t, client.Close())
	})

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
