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
	"sync"
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
	a1 := l.stamp(WSEventOut{RunID: "a"})
	assert.Equal(t, uint64(1), a1.Seq)
	assert.Equal(t, uint64(2), l.stamp(WSEventOut{RunID: "a"}).Seq)
	b1 := l.stamp(WSEventOut{RunID: "b"})
	assert.Equal(t, uint64(1), b1.Seq)
	assert.Equal(t, []uint64{1, 2, 1}, seqs(l.replay()))

	l.ack("a", a1.Exec, 1)
	assert.Equal(t, []uint64{2, 1}, seqs(l.replay()))
	l.ack("a", a1.Exec, 2)
	l.ack("b", b1.Exec, 5)
	assert.Empty(t, l.replay())
	assert.Empty(t, l.unackedRuns())
	// Numbering continues after an ack; only a new dispatch starts a new execution.
	assert.Equal(t, uint64(3), l.stamp(WSEventOut{RunID: "a"}).Seq)
	l.reset("a")
	next := l.stamp(WSEventOut{RunID: "a"})
	assert.Equal(t, uint64(1), next.Seq)
	assert.NotEmpty(t, next.Exec)
	assert.NotEqual(t, a1.Exec, next.Exec, "a new execution gets a new exec id")
}

// An ack meant for an earlier execution of the run must not drop the new execution's events.
func TestDeliveryLog_IgnoresAcksOfAnotherExecution(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	old := l.stamp(WSEventOut{RunID: "a"})
	l.reset("a")
	l.stamp(WSEventOut{RunID: "a"})
	l.ack("a", old.Exec, 1)
	assert.Equal(t, []uint64{1}, seqs(l.replay()))
}

func TestDeliveryLog_AckRequestOnlyForUnacknowledgedEvents(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	e1 := l.stamp(WSEventOut{RunID: "a"})
	l.stamp(WSEventOut{RunID: "a"})

	req, ok := l.ackRequest("a", e1.Exec, 2)
	assert.True(t, ok)
	assert.Equal(t, ackRequestMsg{Type: "ack_request", RunID: "a", Exec: e1.Exec, Seq: 2}, req)

	_, ok = l.ackRequest("a", "other-exec", 2)
	assert.False(t, ok)
	l.ack("a", e1.Exec, 2)
	_, ok = l.ackRequest("a", e1.Exec, 2)
	assert.False(t, ok, "everything is acknowledged")
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

// A run that finished while its last events (possibly "complete") were lost is still claimed,
// after the runs that are executing: the coordinator honours only so many claims.
func TestResumeRunIDs_ExecutingRunsFirstThenRunsWithUnackedEvents(t *testing.T) {
	out := make(chan interface{}, 10)
	d := NewAgentDispatcher("ws://localhost", "tok", true, out)
	d.delivery.setEnabled(true)
	d.activeRunners["z-running"] = nil
	d.SendWSEvent("a-finished", "complete", nil)
	ev := (<-out).(WSEventOut)
	assert.Equal(t, []string{"z-running", "a-finished"}, d.ResumeRunIDs())

	d.Dispatch(context.Background(), WSMessageIn{Type: "ack", RunID: "a-finished", Exec: ev.Exec, Seq: 1})
	assert.Equal(t, []string{"z-running"}, d.ResumeRunIDs())
}

// Runs send events from several goroutines; a run's events must still be queued in seq order, or
// the writer would skip the lower seq as already sent and the coordinator as a duplicate.
func TestSendWSEvent_QueuesEachRunsEventsInSeqOrder(t *testing.T) {
	const senders, perSender = 8, 500
	out := make(chan interface{}, senders*perSender)
	d := NewAgentDispatcher("ws://localhost", "tok", true, out)
	d.delivery.setEnabled(true)
	var wg sync.WaitGroup
	for i := 0; i < senders; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < perSender; j++ {
				d.SendWSEvent("run-1", "result", nil)
			}
		}()
	}
	wg.Wait()
	close(out)
	var want uint64
	for msg := range out {
		want++
		assert.Equal(t, want, msg.(WSEventOut).Seq)
	}
	assert.Equal(t, uint64(senders*perSender), want)
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

// The coordinator acknowledges on its own only every so many events and on terminal ones; the
// tail of a run is acknowledged once the agent asks, after the connection has gone quiet.
func TestAgentSession_AsksForAcknowledgementOfTheTailWhenQuiet(t *testing.T) {
	type frame struct {
		Type  string `json:"type"`
		RunID string `json:"runId"`
		Exec  string `json:"exec"`
		Seq   uint64 `json:"seq"`
	}
	requests := make(chan frame, 10)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(deliveryHeader, "ack")
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
			if f.Type == "ack_request" {
				requests <- f
				_ = wsjson.Write(r.Context(), c, frame{Type: "ack", RunID: f.RunID, Exec: f.Exec, Seq: f.Seq})
			}
		}
	}))
	defer ts.Close()

	session := newAgentSession(ts.URL, "tok", true)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = session.runConnection(ctx, "ws"+strings.TrimPrefix(ts.URL, "http"), nil, false, nil) }()
	waitDeliveryEnabled(t, session)
	session.dispatcher.SendWSEvent("run-1", "runner_log", nil)
	session.dispatcher.SendWSEvent("run-1", "runner_log", nil)

	select {
	case req := <-requests:
		assert.Equal(t, "run-1", req.RunID)
		assert.Equal(t, uint64(2), req.Seq)
		assert.NotEmpty(t, req.Exec)
	case <-time.After(ackRequestDelay + 2*time.Second):
		t.Fatal("no ack request after the connection went quiet")
	}
	assert.Eventually(t, func() bool { return len(session.dispatcher.delivery.replay()) == 0 }, 2*time.Second, 10*time.Millisecond)
	assert.Empty(t, session.dispatcher.ResumeRunIDs())
}
