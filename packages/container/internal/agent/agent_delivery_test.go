// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

// waitDeliveryEnabled waits until the session has read the coordinator's delivery header (the
// server side sees the connection before Dial returns to the agent).
func waitDeliveryEnabled(t *testing.T, s *agentSession) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.dispatcher.delivery.mu.Lock()
		enabled := s.dispatcher.delivery.enabled
		s.dispatcher.delivery.mu.Unlock()
		if enabled {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("delivery never enabled")
}

func seqs(msgs []WSEventOut) []uint64 {
	out := make([]uint64, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, m.Seq)
	}
	return out
}

func TestDeliveryLog_NumbersPerRunAndKeepsUntilAcked(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	assert.Equal(t, uint64(1), l.stamp(WSEventOut{RunID: "a"}).Seq)
	assert.Equal(t, uint64(2), l.stamp(WSEventOut{RunID: "a"}).Seq)
	assert.Equal(t, uint64(1), l.stamp(WSEventOut{RunID: "b"}).Seq)
	assert.Equal(t, []uint64{1, 2, 1}, seqs(l.replay()))

	l.ack("a", 1)
	assert.Equal(t, []uint64{2, 1}, seqs(l.replay()))
	l.ack("a", 2)
	l.ack("b", 5)
	assert.Empty(t, l.replay())
	assert.Empty(t, l.unackedRuns())
	// Numbering continues after an ack; only a new dispatch starts it over.
	assert.Equal(t, uint64(3), l.stamp(WSEventOut{RunID: "a"}).Seq)
	l.reset("a")
	assert.Equal(t, uint64(1), l.stamp(WSEventOut{RunID: "a"}).Seq)
}

// Against a coordinator that never acknowledges, keeping messages would only grow memory and
// replay duplicates, so nothing is kept.
func TestDeliveryLog_KeepsNothingWithoutCoordinatorSupport(t *testing.T) {
	l := newDeliveryLog()
	assert.Equal(t, uint64(1), l.stamp(WSEventOut{RunID: "a"}).Seq)
	assert.Empty(t, l.replay())

	l.setEnabled(true)
	l.stamp(WSEventOut{RunID: "a"})
	assert.Len(t, l.replay(), 1)
	l.setEnabled(false)
	assert.Empty(t, l.replay())
}

func TestDeliveryLog_BoundedPerRun(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	for i := 0; i < maxUnackedPerRun+5; i++ {
		l.stamp(WSEventOut{RunID: "a"})
	}
	kept := l.replay()
	assert.Len(t, kept, maxUnackedPerRun)
	assert.Equal(t, uint64(6), kept[0].Seq, "the oldest are dropped")
}

func TestDeliveryLog_GCDropsIdleLogsOfFinishedRunsOnly(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := newDeliveryLog()
	l.now = func() time.Time { return now }
	l.setEnabled(true)
	l.stamp(WSEventOut{RunID: "finished"})
	l.stamp(WSEventOut{RunID: "running"})

	now = now.Add(idleRunLogTTL - time.Minute)
	l.gc(func(string) bool { return false })
	assert.Len(t, l.replay(), 2, "not idle long enough")

	now = now.Add(2 * time.Minute)
	l.gc(func(id string) bool { return id == "running" })
	assert.Equal(t, []string{"running"}, l.unackedRuns())
}

// A run that finished while its last events (possibly "complete") were lost is still claimed.
func TestResumeRunIDs_IncludesRunsWithUnackedEvents(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	d.delivery.setEnabled(true)
	d.activeRunners["running"] = nil
	d.SendWSEvent("finished", "complete", nil)
	assert.Equal(t, []string{"finished", "running"}, d.ResumeRunIDs())

	d.Dispatch(context.Background(), WSMessageIn{Type: "ack", RunID: "finished", Seq: 1})
	assert.Equal(t, []string{"running"}, d.ResumeRunIDs())
}

// The whole point: events written into a connection that silently died are sent again on the
// next one, each exactly once, and only to a coordinator that acknowledges events.
func TestAgentSession_ReplaysUnacknowledgedEventsAfterReconnect(t *testing.T) {
	type frame struct {
		Type  string `json:"type"`
		RunID string `json:"runId"`
		Seq   uint64 `json:"seq"`
	}
	conns := make(chan chan frame, 2)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(deliveryHeader, "ack")
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")
		frames := make(chan frame, 50)
		conns <- frames
		for {
			var f frame
			if err := wsjson.Read(r.Context(), c, &f); err != nil {
				return
			}
			frames <- f
		}
	}))
	defer ts.Close()
	url := "ws" + strings.TrimPrefix(ts.URL, "http")

	session := newAgentSession(ts.URL, "tok", true)
	session.dispatcher.activeRunners["run-1"] = nil

	// First connection: two events go out and are never acknowledged (lost with the connection).
	ctx1, cancel1 := context.WithCancel(context.Background())
	done1 := make(chan struct{})
	go func() {
		_ = session.runConnection(ctx1, url, nil, false, nil)
		close(done1)
	}()
	first := <-conns
	waitDeliveryEnabled(t, session)
	session.dispatcher.SendWSEvent("run-1", "result", nil)
	session.dispatcher.SendWSEvent("run-1", "result", nil)
	assert.Equal(t, uint64(1), (<-first).Seq)
	assert.Equal(t, uint64(2), (<-first).Seq)
	cancel1()
	<-done1

	// Produced while disconnected: queued, and in the log.
	session.dispatcher.SendWSEvent("run-1", "complete", nil)

	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	go func() { _ = session.runConnection(ctx2, url, nil, false, nil) }()
	second := <-conns
	var got []uint64
	for len(got) < 3 {
		select {
		case f := <-second:
			got = append(got, f.Seq)
		case <-time.After(2 * time.Second):
			t.Fatalf("replay incomplete: got seqs %v", got)
		}
	}
	assert.Equal(t, []uint64{1, 2, 3}, got)
	select {
	case f := <-second:
		t.Fatalf("seq %d was sent twice", f.Seq)
	case <-time.After(200 * time.Millisecond):
	}
}

func TestAgentSession_NoReplayWithoutDeliverySupport(t *testing.T) {
	conns := make(chan chan uint64, 2)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil) // no delivery header: an older coordinator
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")
		frames := make(chan uint64, 50)
		conns <- frames
		for {
			var f struct {
				Seq uint64 `json:"seq"`
			}
			if err := wsjson.Read(r.Context(), c, &f); err != nil {
				return
			}
			frames <- f.Seq
		}
	}))
	defer ts.Close()
	url := "ws" + strings.TrimPrefix(ts.URL, "http")

	session := newAgentSession(ts.URL, "tok", true)
	ctx1, cancel1 := context.WithCancel(context.Background())
	done1 := make(chan struct{})
	go func() {
		_ = session.runConnection(ctx1, url, nil, false, nil)
		close(done1)
	}()
	first := <-conns
	session.dispatcher.SendWSEvent("run-1", "result", nil)
	<-first
	cancel1()
	<-done1

	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	go func() { _ = session.runConnection(ctx2, url, nil, false, nil) }()
	second := <-conns
	select {
	case seq := <-second:
		t.Fatalf("seq %d was replayed to a coordinator that does not acknowledge", seq)
	case <-time.After(300 * time.Millisecond):
	}
}
