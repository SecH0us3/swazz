// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"context"
	"crypto/ed25519"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

func timeoutSession(url string) *agentSession {
	s := newAgentSession(url, "tok", true)
	s.connectTimeout, s.writeTimeout = 200*time.Millisecond, 200*time.Millisecond
	s.minWriteRate = 1 << 30 // the deadline is the base timeout
	return s
}

// runConnectionWithin runs one connection and returns its error, failing the test if it is still
// running after limit.
func runConnectionWithin(t *testing.T, s *agentSession, wsURL string, signatureAuth bool, limit time.Duration) error {
	t.Helper()
	var priv ed25519.PrivateKey
	if signatureAuth {
		_, k, err := ed25519.GenerateKey(nil)
		require.NoError(t, err)
		priv = k
	}
	done := make(chan error, 1)
	go func() { done <- s.runConnection(context.Background(), wsURL, nil, signatureAuth, priv) }()
	select {
	case err := <-done:
		return err
	case <-time.After(limit):
		t.Fatalf("the agent was still connecting or writing after %v", limit)
		return nil
	}
}

func wsURLOf(ts *httptest.Server) string { return "ws" + strings.TrimPrefix(ts.URL, "http") }

// A coordinator that accepts the TCP connection but never answers the upgrade is given up on.
func TestRunConnection_UpgradeTimesOut(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			defer conn.Close() // held open, never answered
		}
	}()

	err = runConnectionWithin(t, timeoutSession(""), "ws://"+ln.Addr().String(), false, 5*time.Second)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to connect")
}

// A coordinator that upgrades but never sends the challenge is given up on.
func TestRunConnection_ChallengeTimesOut(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		<-r.Context().Done()
	}))
	defer ts.Close()

	err := runConnectionWithin(t, timeoutSession(ts.URL), wsURLOf(ts), true, 5*time.Second)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "challenge")
}

// A coordinator that stops reading: the write that can no longer go out times out and ends the
// connection, which goes back to the reconnect loop. Its message is kept for the next connection.
func TestRunConnection_StuckWriteTimesOut(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		<-r.Context().Done() // never reads
	}))
	defer ts.Close()

	s := timeoutSession(ts.URL)
	big := strings.Repeat("x", 512<<10)
	for range 200 { // ~100 MB, far past what the socket buffers hold
		s.dispatcher.SendWSEvent("run-1", "result", big)
	}
	err := runConnectionWithin(t, s, wsURLOf(ts), false, 10*time.Second)
	require.Error(t, err)
	assert.Eventually(t, func() bool { return len(s.carry) == 1 }, 2*time.Second, 10*time.Millisecond,
		"the message whose write timed out waits for the next connection")
}

// The setup deadline ends with the setup: the connection then lives on past it, with token or
// signature auth.
func TestRunConnection_ConnectionOutlivesTheSetupDeadline(t *testing.T) {
	for _, signatureAuth := range []bool{false, true} {
		t.Run(map[bool]string{false: "token", true: "signature"}[signatureAuth], func(t *testing.T) {
			_, priv, err := ed25519.GenerateKey(nil)
			require.NoError(t, err)
			got := make(chan string, 1)
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				c, err := websocket.Accept(w, r, nil)
				if err != nil {
					return
				}
				defer c.CloseNow()
				ctx := r.Context()
				if signatureAuth {
					_ = wsjson.Write(ctx, c, map[string]string{"type": "challenge", "nonce": "n"})
					var resp map[string]string
					if wsjson.Read(ctx, c, &resp) != nil {
						return
					}
					_ = wsjson.Write(ctx, c, map[string]string{"type": "auth_ok"})
				}
				var f map[string]any
				if wsjson.Read(ctx, c, &f) == nil {
					got <- f["type"].(string)
				}
				<-ctx.Done()
			}))
			defer ts.Close()

			s := timeoutSession(ts.URL)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			ended := make(chan error, 1)
			go func() { ended <- s.runConnection(ctx, wsURLOf(ts), nil, signatureAuth, priv) }()

			time.Sleep(3 * s.connectTimeout)
			s.dispatcher.SendWSError("run-1", "boom")
			select {
			case typ := <-got:
				assert.Equal(t, "error", typ)
			case err := <-ended:
				t.Fatalf("the connection ended: %v", err)
			case <-time.After(5 * time.Second):
				t.Fatal("the message sent after the setup deadline never arrived")
			}
		})
	}
}

func TestWriteDeadlineGrowsWithTheMessage(t *testing.T) {
	s := newAgentSession("", "tok", true)
	assert.Equal(t, writeTimeout, s.writeDeadline(0))
	assert.Equal(t, writeTimeout+128*time.Second, s.writeDeadline(1<<20))
}
