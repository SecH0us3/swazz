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

func noneActive(string) bool { return false }

func stamped(t *testing.T, l *deliveryLog, msg WSEventOut) WSEventOut {
	t.Helper()
	out, ok := l.stamp(msg)
	if !ok {
		t.Fatalf("stamp refused %+v", msg)
	}
	return out
}

// sent stamps msg and records it as written on the connection, as the write loop does.
func sent(t *testing.T, l *deliveryLog, msg WSEventOut) WSEventOut {
	t.Helper()
	out := stamped(t, l, msg)
	l.written(out, true)
	return out
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
	l.now = func() time.Time { return time.Unix(1_000_000, 0) } // replay order then falls back to run id
	l.setEnabled(true)
	a1 := sent(t, l, WSEventOut{RunID: "a"})
	assert.Equal(t, uint64(1), a1.Seq)
	assert.Equal(t, uint64(2), sent(t, l, WSEventOut{RunID: "a"}).Seq)
	b1 := sent(t, l, WSEventOut{RunID: "b"})
	assert.Equal(t, uint64(1), b1.Seq)
	assert.Equal(t, []uint64{1, 2, 1}, seqs(l.replay(noneActive)))

	l.ack("a", a1.Exec, 1)
	assert.Equal(t, []uint64{2, 1}, seqs(l.replay(noneActive)))
	l.ack("a", a1.Exec, 2)
	l.ack("b", b1.Exec, 5)
	assert.Empty(t, l.replay(noneActive))
	assert.Empty(t, l.undeliveredRuns())
	// Numbering continues after an ack; only a new dispatch starts a new execution.
	assert.Equal(t, uint64(3), sent(t, l, WSEventOut{RunID: "a"}).Seq)
	l.reset("a")
	next := sent(t, l, WSEventOut{RunID: "a"})
	assert.Equal(t, uint64(1), next.Seq)
	assert.NotEmpty(t, next.Exec)
	assert.NotEqual(t, a1.Exec, next.Exec, "a new execution gets a new exec id")
}

// An ack meant for an earlier execution of the run must not drop the new execution's events.
func TestDeliveryLog_IgnoresAcksOfAnotherExecution(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	old := sent(t, l, WSEventOut{RunID: "a"})
	l.reset("a")
	sent(t, l, WSEventOut{RunID: "a"})
	l.ack("a", old.Exec, 1)
	assert.Equal(t, []uint64{1}, seqs(l.replay(noneActive)))

}

func TestDeliveryLog_AckRequestOnlyForUnacknowledgedEvents(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	e1 := sent(t, l, WSEventOut{RunID: "a"})
	sent(t, l, WSEventOut{RunID: "a"})

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
	assert.Equal(t, uint64(1), sent(t, l, WSEventOut{RunID: "a"}).Seq)
	assert.Empty(t, l.replay(noneActive))

	l.setEnabled(true)
	sent(t, l, WSEventOut{RunID: "a"})
	assert.Len(t, l.replay(noneActive), 1)
	l.setEnabled(false)
	assert.Empty(t, l.replay(noneActive))
}

func TestDeliveryLog_BoundedPerRun(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	for i := 0; i < maxUnackedPerRun+5; i++ {
		sent(t, l, WSEventOut{RunID: "a"})
	}
	kept := l.replay(noneActive)
	// Beyond the bound the oldest half goes at once (one copy, not one per event).
	assert.Len(t, kept, maxUnackedPerRun/2+4)
	assert.Equal(t, uint64(maxUnackedPerRun/2+2), kept[0].Seq, "the oldest are dropped")
	assert.Equal(t, uint64(maxUnackedPerRun+5), kept[len(kept)-1].Seq)
	assert.LessOrEqual(t, cap(l.runs["a"].unacked), maxUnackedPerRun, "dropped events are not kept reachable")
}

// Late events of an earlier execution, still draining after the run was dispatched here again,
// must not be numbered as the new execution's: their seqs would collide with its own events.
func TestDeliveryLog_RefusesLateEventsOfAnEarlierExecution(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	first := l.reset("a")
	sent(t, l, WSEventOut{RunID: "a", Exec: first})
	second := l.reset("a")
	assert.NotEqual(t, first, second)

	_, ok := l.stamp(WSEventOut{RunID: "a", Exec: first})
	assert.False(t, ok)
	ev := stamped(t, l, WSEventOut{RunID: "a", Exec: second})
	assert.Equal(t, uint64(1), ev.Seq)
	// Events that name no execution belong to the current one.
	assert.Equal(t, second, sent(t, l, WSEventOut{RunID: "a"}).Exec)
}

// After a reconnect, executing runs' events go out before those of finished or refused runs.
func TestDeliveryLog_ReplaysExecutingRunsFirst(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := newDeliveryLog()
	l.now = func() time.Time { return now }
	l.setEnabled(true)
	sent(t, l, WSEventOut{RunID: "finished-old"})
	now = now.Add(time.Second)
	sent(t, l, WSEventOut{RunID: "running"})
	now = now.Add(time.Second)
	sent(t, l, WSEventOut{RunID: "finished-new"})

	var order []string
	for _, m := range l.replay(func(id string) bool { return id == "running" }) {
		order = append(order, m.RunID)
	}
	assert.Equal(t, []string{"running", "finished-new", "finished-old"}, order)
}

func TestDeliveryLog_GCDropsIdleLogsOfFinishedRunsOnly(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := newDeliveryLog()
	l.now = func() time.Time { return now }
	l.setEnabled(true)
	sent(t, l, WSEventOut{RunID: "finished"})
	sent(t, l, WSEventOut{RunID: "running"})

	now = now.Add(idleRunLogTTL - time.Minute)
	l.gc(func(string) bool { return false })
	assert.Len(t, l.replay(noneActive), 2, "not idle long enough")

	now = now.Add(2 * time.Minute)
	l.gc(func(id string) bool { return id == "running" })
	assert.Equal(t, []string{"running"}, l.undeliveredRuns())
}

// The log keeps only what was written: an event still queued is not replayed (the queue sends it),
// but its run counts as undelivered until it is written, or given up on.
func TestDeliveryLog_KeepsWhatWasWritten(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	e1 := stamped(t, l, WSEventOut{RunID: "a"})
	e2 := stamped(t, l, WSEventOut{RunID: "a"})
	assert.Empty(t, l.replay(noneActive), "queued, not written")
	assert.Equal(t, []string{"a"}, l.undeliveredRuns())

	l.written(e1, true)
	l.written(e1, true) // written again by a replay: kept once
	assert.Equal(t, []uint64{1}, seqs(l.replay(noneActive)))
	l.ack("a", e1.Exec, 1)
	assert.Equal(t, []string{"a"}, l.undeliveredRuns(), "seq 2 is still queued")

	l.written(e2, false) // too large to send: given up on
	assert.Empty(t, l.replay(noneActive))
	assert.Empty(t, l.undeliveredRuns())

	// An event of an execution that was replaced is not kept.
	late := stamped(t, l, WSEventOut{RunID: "a"})
	l.reset("a")
	l.written(late, true)
	assert.Empty(t, l.replay(noneActive))
}

// A message carried over from a failed write can be written after later ones (a later one given
// up on, or written on the next connection first). It must still be kept for replay, in order.
func TestDeliveryLog_KeepsALateCarriedMessage(t *testing.T) {
	l := newDeliveryLog()
	l.setEnabled(true)
	e1 := stamped(t, l, WSEventOut{RunID: "a"})
	e2 := stamped(t, l, WSEventOut{RunID: "a"})
	e3 := stamped(t, l, WSEventOut{RunID: "a"})
	l.written(e1, true)
	l.written(e3, true)
	assert.False(t, l.kept(e2))
	l.written(e2, true) // carried, written last
	assert.Equal(t, []uint64{1, 2, 3}, seqs(l.replay(noneActive)))
	assert.True(t, l.kept(e2))

	// An acknowledged message is not kept again by a late write.
	l.ack("a", e1.Exec, 3)
	l.written(e2, true)
	assert.Empty(t, l.replay(noneActive))
	assert.True(t, l.kept(e2), "acknowledged: nothing to resend")
}

// The log of a run with queued messages is what claims the run after a reconnect; an outage longer
// than idleRunLogTTL must not discard it.
func TestDeliveryLog_GCKeepsRunsWithQueuedMessages(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := newDeliveryLog()
	l.now = func() time.Time { return now }
	l.setEnabled(true)
	ev := stamped(t, l, WSEventOut{RunID: "finished"})
	now = now.Add(2 * idleRunLogTTL)
	l.gc(noneActive)
	assert.Equal(t, []string{"finished"}, l.undeliveredRuns())
	l.written(ev, false)
	l.gc(noneActive)
	assert.Empty(t, l.undeliveredRuns())
}

// A run that finished while its last events (possibly "complete") were lost is still claimed,
// after the runs that are executing: the coordinator honours only so many claims.
func TestResumeRunIDs_ExecutingRunsFirstThenRunsWithUnackedEvents(t *testing.T) {
	out := make(chan interface{}, 10)
	d := NewAgentDispatcher("ws://localhost", "tok", true, out)
	t.Cleanup(d.Close)
	d.delivery.setEnabled(true)
	d.activeRunners["z-running"] = nil
	d.SendWSEvent("a-finished", "complete", nil)
	ev := (<-out).(WSEventOut)
	assert.Equal(t, []string{"z-running", "a-finished"}, d.ResumeRunIDs(), "queued")
	d.delivery.written(ev, true)
	assert.Equal(t, []string{"z-running", "a-finished"}, d.ResumeRunIDs(), "written, not acknowledged")

	d.Dispatch(context.Background(), WSMessageIn{Type: "ack", RunID: "a-finished", Exec: ev.Exec, Seq: 1})
	assert.Equal(t, []string{"z-running"}, d.ResumeRunIDs())
}

// Runs send events from several goroutines; a run's events must still be queued in seq order, or
// the writer would skip the lower seq as already sent and the coordinator as a duplicate.
func TestSendWSEvent_QueuesEachRunsEventsInSeqOrder(t *testing.T) {
	const senders, perSender = 8, 500
	out := make(chan interface{}, senders*perSender)
	d := NewAgentDispatcher("ws://localhost", "tok", true, out)
	t.Cleanup(d.Close)
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
	for want := uint64(1); want <= senders*perSender; want++ {
		select {
		case msg := <-out:
			assert.Equal(t, want, msg.(WSEventOut).Seq)
		case <-time.After(2 * time.Second):
			t.Fatalf("only %d events arrived", want-1)
		}
	}
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
	t.Cleanup(session.dispatcher.Close)
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

	// Produced while disconnected: queued, behind the two the log replays.
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
	t.Cleanup(session.dispatcher.Close)
	ctx1, cancel1 := context.WithCancel(context.Background())
	done1 := make(chan struct{})
	go func() {
		_ = session.runConnection(ctx1, url, nil, false, nil)
		close(done1)
	}()
	first := <-conns
	session.dispatcher.SendWSEvent("run-1", "result", nil)
	session.dispatcher.SendWSEvent("run-1", "result", nil)
	<-first
	// Seq 2 is written only once the write of seq 1 has returned, so seq 1 is now fully sent.
	// Seq 2's write may still be in flight when the connection is cancelled: a write that fails
	// that way is carried to the next connection (at least once), which is not a replay.
	<-first
	cancel1()
	<-done1

	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	go func() { _ = session.runConnection(ctx2, url, nil, false, nil) }()
	second := <-conns
	deadline := time.After(300 * time.Millisecond)
	for {
		select {
		case seq := <-second:
			if seq == 1 {
				t.Fatalf("seq %d was replayed to a coordinator that does not acknowledge", seq)
			}
		case <-deadline:
			return
		}
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
	t.Cleanup(session.dispatcher.Close)
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
	assert.Eventually(t, func() bool { return len(session.dispatcher.delivery.replay(noneActive)) == 0 }, 2*time.Second, 10*time.Millisecond)
	assert.Empty(t, session.dispatcher.ResumeRunIDs())
}

// A run that keeps streaming must not hold back the acknowledgement of another run's tail.
func TestAgentSession_AsksPerRunWhileAnotherRunStreams(t *testing.T) {
	type frame struct {
		Type  string `json:"type"`
		RunID string `json:"runId"`
	}
	requested := make(chan string, 10)
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
				requested <- f.RunID
			}
		}
	}))
	defer ts.Close()

	session := newAgentSession(ts.URL, "tok", true)
	t.Cleanup(session.dispatcher.Close)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = session.runConnection(ctx, "ws"+strings.TrimPrefix(ts.URL, "http"), nil, false, nil) }()
	waitDeliveryEnabled(t, session)

	session.dispatcher.SendWSEvent("quiet", "runner_log", nil)
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		tick := time.NewTicker(ackRequestDelay / 10)
		defer tick.Stop()
		for {
			select {
			case <-stop:
				return
			case <-tick.C:
				session.dispatcher.SendWSEvent("streaming", "result", nil)
			}
		}
	}()

	select {
	case runID := <-requested:
		assert.Equal(t, "quiet", runID)
	case <-time.After(ackRequestDelay + 2*time.Second):
		t.Fatal("the quiet run's tail was never offered for acknowledgement")
	}
}
