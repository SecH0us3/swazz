// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"context"
	"encoding/json"
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

func TestActiveRunIDs_Sorted(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 1))
	assert.Empty(t, d.ActiveRunIDs())
	d.activeRunners["run-b"] = nil
	d.activeRunners["run-a"] = nil
	assert.Equal(t, []string{"run-a", "run-b"}, d.ActiveRunIDs())
}

// A scan that keeps running across a reconnect must be claimed by the new connection itself (in
// its URL), so the coordinator hands the run over before any of its queued events arrive.
func TestAgentSession_ReconnectClaimsRunsInConnectionURL(t *testing.T) {
	type frame struct {
		Type  string `json:"type"`
		RunID string `json:"runId"`
	}
	resumeParam := make(chan string, 1)
	frames := make(chan frame, 10)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resumeParam <- r.URL.Query().Get("resume")
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")
		var f frame
		if err := wsjson.Read(r.Context(), c, &f); err == nil {
			frames <- f
		}
	}))
	defer ts.Close()

	session := newAgentSession(ts.URL, "tok", true)
	session.dispatcher.activeRunners["run-b"] = nil // scans still running from the previous connection
	session.dispatcher.activeRunners["run-a"] = nil
	session.dispatcher.SendWSEvent("run-a", "result", map[string]int{"status": 200})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = session.runConnection(ctx, "ws"+strings.TrimPrefix(ts.URL, "http")+"/connect?name=r1", nil, false, nil)
	}()

	assert.Equal(t, "run-a,run-b", <-resumeParam)
	f := <-frames
	assert.Equal(t, "event", f.Type)
	assert.Equal(t, "run-a", f.RunID)
}

func TestWithResumeParam(t *testing.T) {
	u, ids, err := withResumeParam("wss://c.example/api/runners/connect?name=r1", nil)
	require.NoError(t, err)
	assert.Equal(t, "wss://c.example/api/runners/connect?name=r1", u)
	assert.Nil(t, ids)

	u, ids, err = withResumeParam("wss://c.example/api/runners/connect?name=r1&resume=stale", []string{"a", "b"})
	require.NoError(t, err)
	assert.Equal(t, "wss://c.example/api/runners/connect?name=r1&resume=a%2Cb", u)
	assert.Equal(t, []string{"a", "b"}, ids)
}

func TestHandleJobDispatch_IgnoresRunAlreadyRunning(t *testing.T) {
	out := make(chan interface{}, 10)
	d := NewAgentDispatcher("ws://localhost", "tok", true, out)
	d.activeRunners["run-1"] = nil
	payload, _ := json.Marshal(map[string]interface{}{"runId": "run-1", "config": map[string]interface{}{}})

	d.handleJobDispatch(context.Background(), WSMessageIn{Type: "job_dispatch", Payload: payload})

	assert.Nil(t, d.activeRunners["run-1"], "the running scan must not be replaced")
	assert.Empty(t, out, "nothing may be reported for the duplicate dispatch")
}

func TestAgentSession_NoResumeWithoutActiveRuns(t *testing.T) {
	resumeParam := make(chan string, 1)
	got := make(chan string, 1)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, has := r.URL.Query()["resume"]
		resumeParam <- map[bool]string{true: "present", false: "absent"}[has]
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")
		var f map[string]interface{}
		if err := wsjson.Read(r.Context(), c, &f); err == nil {
			got <- f["type"].(string)
		}
	}))
	defer ts.Close()

	session := newAgentSession(ts.URL, "tok", true)
	session.dispatcher.SendWSError("run-x", "boom")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = session.runConnection(ctx, "ws"+strings.TrimPrefix(ts.URL, "http"), nil, false, nil)
	}()
	assert.Equal(t, "absent", <-resumeParam)
	assert.Equal(t, "error", <-got)
}

func fastHeartbeatSession(url string) *agentSession {
	s := newAgentSession(url, "tok", true)
	s.heartbeatInterval, s.heartbeatTimeout = 20*time.Millisecond, 100*time.Millisecond
	return s
}

// heartbeatServer reads the agent's frames, answers the first ping with a pong when answerOnce is
// set, and reports how many exact heartbeat pings arrived before the connection ended. It never
// touches t: the handler can outlive the test.
func heartbeatServer(answerOnce bool, pings chan<- int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")
		count := 0
		defer func() { pings <- count }()
		for {
			_, b, err := c.Read(r.Context())
			if err != nil {
				return
			}
			var f map[string]interface{}
			if json.Unmarshal(b, &f) != nil || f["type"] != "ping" || string(b) != heartbeatPing {
				continue
			}
			count++
			if answerOnce && count == 1 {
				_ = c.Write(r.Context(), websocket.MessageText, []byte(`{"type":"pong"}`))
			}
		}
	}))
}

func TestAgentSession_HeartbeatTimeoutClosesDeadConnection(t *testing.T) {
	pings := make(chan int, 1)
	ts := heartbeatServer(true, pings)
	defer ts.Close()

	done := make(chan error, 1)
	go func() {
		done <- fastHeartbeatSession(ts.URL).runConnection(context.Background(), "ws"+strings.TrimPrefix(ts.URL, "http"), nil, false, nil)
	}()
	select {
	case err := <-done:
		require.Error(t, err) // the agent gave up on the silent connection and returns to reconnect
	case <-time.After(3 * time.Second):
		t.Fatal("agent kept a connection whose heartbeat went unanswered")
	}
	assert.GreaterOrEqual(t, <-pings, 2)
}

// A coordinator without heartbeat support never answers pings; the agent must not drop it.
func TestAgentSession_HeartbeatNotEnforcedWithoutPongSupport(t *testing.T) {
	pings := make(chan int, 1)
	ts := heartbeatServer(false, pings)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := fastHeartbeatSession(ts.URL).runConnection(ctx, "ws"+strings.TrimPrefix(ts.URL, "http"), nil, false, nil)
	require.Error(t, err)
	// Ended by the test's deadline, well past heartbeatTimeout, not by the agent giving up.
	assert.GreaterOrEqual(t, time.Since(start), 400*time.Millisecond)
	assert.NotContains(t, err.Error(), "heartbeat timeout")
	assert.GreaterOrEqual(t, <-pings, 5)
}

// A message whose write failed on a dead connection is resent by the live one, even when the
// failure is only detected after the new connection is already up.
func TestAgentSession_CarriedMessagesAreResent(t *testing.T) {
	type frame struct {
		Type  string `json:"type"`
		RunID string `json:"runId"`
	}
	frames := make(chan frame, 10)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")
		for {
			var f frame
			if err := wsjson.Read(r.Context(), c, &f); err != nil {
				return
			}
			frames <- f
		}
	}))
	defer ts.Close()

	session := newAgentSession(ts.URL, "tok", true)
	session.carry <- WSEventOut{Type: "event", RunID: "carried-before"}
	session.dispatcher.SendWSEvent("queued", "result", nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = session.runConnection(ctx, "ws"+strings.TrimPrefix(ts.URL, "http"), nil, false, nil)
	}()

	assert.Equal(t, "carried-before", (<-frames).RunID, "carried messages go ahead of the queue")
	assert.Equal(t, "queued", (<-frames).RunID)

	// A late failure from the previous connection's writer lands in carry while this one is live.
	session.carry <- WSEventOut{Type: "event", RunID: "carried-late"}
	select {
	case f := <-frames:
		assert.Equal(t, "carried-late", f.RunID)
	case <-time.After(2 * time.Second):
		t.Fatal("a message carried over while connected was never sent")
	}
}
