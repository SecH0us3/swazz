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
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
	"swazz-engine/internal/config"
	"swazz-engine/internal/runner"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"
)

func smallOutbox(high, low, hardLimit int) *outbox {
	o := newOutbox()
	o.high, o.low, o.hardLimit = high, low, hardLimit
	return o
}

func TestOutbox_FirstInFirstOutWithMarks(t *testing.T) {
	o := smallOutbox(3, 1, 10)
	assert.False(t, o.push(1))
	assert.False(t, o.push(2))
	assert.True(t, o.push(3), "at the high mark")
	assert.Equal(t, 3, o.pending())

	msg, ok := o.take(nil)
	require.True(t, ok)
	assert.Equal(t, 1, msg)
	assert.Equal(t, 3, o.pending(), "taken but not handed on is still pending")
	assert.Equal(t, 2, o.queued())
	assert.False(t, o.handed(), "2 left, above the low mark")
	msg, _ = o.take(nil)
	assert.Equal(t, 2, msg)
	assert.True(t, o.handed(), "1 left: at the low mark")
	msg, _ = o.take(nil)
	assert.Equal(t, 3, msg)
	assert.True(t, o.handed())
	assert.Equal(t, 0, o.pending())

	stop := make(chan struct{})
	close(stop)
	_, ok = o.take(stop)
	assert.False(t, ok, "an empty outbox gives up once stopped")
}

// Past hardLimit a sender waits, holding no lock, until the pump takes something.
func TestOutbox_WaitRoomBlocksOnlyAtTheHardLimit(t *testing.T) {
	o := smallOutbox(1, 0, 2)
	o.waitRoom()
	o.push(1)
	o.waitRoom()
	o.push(2)
	waited := make(chan struct{})
	go func() {
		o.waitRoom()
		close(waited)
	}()
	select {
	case <-waited:
		t.Fatal("waitRoom returned at the hard limit")
	case <-time.After(50 * time.Millisecond):
	}
	assert.Equal(t, 2, o.pending(), "pending does not wait for the lock a waiter holds")
	_, _ = o.take(nil)
	select {
	case <-waited:
	case <-time.After(2 * time.Second):
		t.Fatal("waitRoom did not return once there was room")
	}
}

func TestOutbox_PumpKeepsOrder(t *testing.T) {
	o := smallOutbox(1000, 10, 2000)
	out := make(chan interface{})
	stop := make(chan struct{})
	defer close(stop)
	var drained atomic.Int32
	go o.pump(out, stop, func() { drained.Add(1) })
	for i := 0; i < 500; i++ {
		o.push(i)
	}
	for i := 0; i < 500; i++ {
		assert.Equal(t, i, <-out)
	}
	assert.Eventually(t, func() bool { return o.pending() == 0 && drained.Load() > 0 }, time.Second, time.Millisecond)
}

// The original failure: with the coordinator away, a run's sender blocked under sendMu once the
// queue filled up, and every other run with it. Queueing must return at once while the queue is
// below its hard limit.
func TestSendWSEvent_DoesNotBlockWhileTheCoordinatorIsAway(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{})) // nobody reads
	d.outbox.high, d.outbox.low = 1_000_000, 0
	done := make(chan struct{})
	go func() {
		for i := 0; i < 60_000; i++ { // more than the old 50000-message channel held
			d.SendWSEvent("run-1", "result", nil)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("queueing blocked")
	}
	assert.Equal(t, 60_000, d.outbox.pending())
}

func heldRunner() *runner.Runner {
	return runner.New(&swagger.Config{}, nil)
}

// Past the high mark every scan is held, including one that starts meanwhile, until the queue
// is back at its low mark.
func TestQueueEvent_HoldsScansUntilTheQueueDrains(t *testing.T) {
	out := make(chan interface{})
	d := NewAgentDispatcher("ws://localhost", "tok", true, out)
	d.outbox.high, d.outbox.low = 10, 2
	running := heldRunner()
	d.activeRunners["running"] = running

	for i := 0; i < 9; i++ {
		d.SendWSEvent("running", "result", nil)
	}
	assert.False(t, running.Held(), "below the high mark")
	d.SendWSEvent("running", "result", nil)
	assert.True(t, running.Held())

	late := heldRunner()
	d.activeRunnersMu.Lock()
	if d.holding {
		late.Hold()
	}
	d.activeRunners["late"] = late
	d.activeRunnersMu.Unlock()
	assert.True(t, late.Held())

	for i := 0; i < 7; i++ { // 10 queued: one taken by the pump, 9 -> 3 left in the queue
		<-out
	}
	assert.True(t, running.Held(), "above the low mark")
	<-out
	assert.Eventually(t, func() bool { return !running.Held() && !late.Held() }, time.Second, time.Millisecond)
}

// A scan dispatched while the scans are held starts held.
func TestHandleJobDispatch_StartsHeldWhileHolding(t *testing.T) {
	safenet.AllowLocalNetwork = true
	defer func() { safenet.AllowLocalNetwork = false }()
	t.Setenv("SWAZZ_DISABLE_TELEMETRY", "true")
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer target.Close()

	out := make(chan interface{}, 1000)
	d := NewAgentDispatcher("ws://localhost", "tok", true, out)
	d.outbox.high, d.outbox.low = 1_000_000, -1 // only this test holds or releases
	d.activeRunnersMu.Lock()
	d.holding = true
	d.held.Store(true)
	d.activeRunnersMu.Unlock()

	payload, err := json.Marshal(JobDispatchPayload{
		RunID: "held-run",
		Config: config.CliConfig{
			BaseURL:             target.URL,
			Security:            swagger.SecurityConfig{AllowPrivateIPs: true},
			EndpointDefinitions: []swagger.EndpointConfig{{Path: "/health", Method: "GET"}},
			Settings: swagger.Settings{
				IterationsPerProfile: 1, Concurrency: 1, TimeoutMs: 500,
				Profiles: []swagger.FuzzingProfile{swagger.ProfileRandom},
			},
		},
	})
	require.NoError(t, err)
	d.Dispatch(context.Background(), WSMessageIn{Type: "job_dispatch", Payload: payload})
	d.activeRunnersMu.Lock()
	r := d.activeRunners["held-run"]
	d.activeRunnersMu.Unlock()
	require.NotNil(t, r)
	assert.True(t, r.Held())

	d.releaseScans()
	assert.False(t, r.Held())
	assert.Eventually(t, func() bool { return !d.isActive("held-run") }, 10*time.Second, 10*time.Millisecond, "the released scan runs to its end")
}

// The loss on master: during an outage a run queued more than the delivery log keeps; after the
// reconnect the log replayed its newest events and the writer then skipped the older, never sent
// ones as already sent. Every event must reach the coordinator, once, in order.
func TestAgentSession_DeliversEverythingQueuedDuringALongOutage(t *testing.T) {
	type frame struct {
		Type string `json:"type"`
		Seq  uint64 `json:"seq"`
	}
	conns := make(chan chan uint64, 2)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(deliveryHeader, "ack")
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "done")
		seqs := make(chan uint64, maxUnackedPerRun*2)
		conns <- seqs
		for {
			var f frame
			if err := wsjson.Read(r.Context(), c, &f); err != nil {
				return
			}
			if f.Type == "event" {
				seqs <- f.Seq
			}
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
	waitDeliveryEnabled(t, session)
	session.dispatcher.SendWSEvent("run-1", "result", nil)
	assert.Equal(t, uint64(1), <-first)
	cancel1()
	<-done1

	const total = maxUnackedPerRun + 1000
	for i := 1; i < total; i++ {
		session.dispatcher.SendWSEvent("run-1", "result", nil)
	}

	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	go func() { _ = session.runConnection(ctx2, url, nil, false, nil) }()
	second := <-conns
	for want := uint64(1); want <= total; want++ {
		select {
		case seq := <-second:
			require.Equal(t, want, seq)
		case <-time.After(5 * time.Second):
			t.Fatalf("stopped at seq %d of %d", want-1, total)
		}
	}
	select {
	case seq := <-second:
		t.Fatalf("seq %d was sent twice", seq)
	case <-time.After(200 * time.Millisecond):
	}
}
