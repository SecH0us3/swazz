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
	"sync/atomic"
	"testing"
	"time"

	"swazz-engine/internal/config"
	"swazz-engine/internal/safenet"
	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// recyclingDispatcher returns a dispatcher whose exit is recorded instead of ending the test.
func recyclingDispatcher(t *testing.T) (*AgentDispatcher, chan int) {
	t.Helper()
	oldPoll, oldTimeout := recyclePollInterval, recycleDrainTimeout
	recyclePollInterval, recycleDrainTimeout = 5*time.Millisecond, time.Second
	t.Cleanup(func() { recyclePollInterval, recycleDrainTimeout = oldPoll, oldTimeout })
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	exits := make(chan int, 4)
	d.exit = func(code int) { exits <- code }
	d.EnableRecycleWhenIdle()
	return d, exits
}

func expectExit(t *testing.T, exits chan int) {
	t.Helper()
	select {
	case code := <-exits:
		assert.Equal(t, 0, code, "a recycle is a clean exit")
	case <-time.After(2 * time.Second):
		t.Fatal("the idle agent did not recycle")
	}
}

func expectNoExit(t *testing.T, exits chan int, within time.Duration) {
	t.Helper()
	select {
	case <-exits:
		t.Fatal("the agent recycled when it must not")
	case <-time.After(within):
	}
}

func TestRecycle_OffByDefault(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	exited := false
	d.exit = func(int) { exited = true }
	d.maybeRecycle()
	time.Sleep(50 * time.Millisecond)
	assert.False(t, exited)
}

func TestRecycle_ExitsOnceIdleAndDelivered(t *testing.T) {
	d, exits := recyclingDispatcher(t)
	d.maybeRecycle()
	d.maybeRecycle() // a second scan ending at the same time
	expectExit(t, exits)
	expectNoExit(t, exits, 50*time.Millisecond)
}

// Results not yet delivered would be lost with the process.
func TestRecycle_WaitsForDelivery(t *testing.T) {
	d, exits := recyclingDispatcher(t)
	var pending atomic.Bool
	pending.Store(true)
	d.pendingOutput = pending.Load
	d.maybeRecycle()
	expectNoExit(t, exits, 50*time.Millisecond)
	pending.Store(false)
	expectExit(t, exits)
}

func TestRecycle_NotWhileAScanRuns(t *testing.T) {
	d, exits := recyclingDispatcher(t)
	d.activeRunners["running"] = nil
	d.maybeRecycle()
	expectNoExit(t, exits, 50*time.Millisecond)
}

// A scan dispatched while the agent waits for delivery cancels the recycle; the next idle moment
// starts it again.
func TestRecycle_ANewScanCancelsIt(t *testing.T) {
	d, exits := recyclingDispatcher(t)
	var pending atomic.Bool
	pending.Store(true)
	d.pendingOutput = pending.Load
	d.maybeRecycle()
	d.activeRunnersMu.Lock()
	d.activeRunners["new"] = nil
	d.activeRunnersMu.Unlock()
	pending.Store(false)
	expectNoExit(t, exits, 100*time.Millisecond)

	d.activeRunnersMu.Lock()
	delete(d.activeRunners, "new")
	d.activeRunnersMu.Unlock()
	d.maybeRecycle()
	expectExit(t, exits)
}

// A coordinator that never acknowledges must not keep the agent from recycling forever.
func TestRecycle_DeliveryWaitIsBounded(t *testing.T) {
	d, exits := recyclingDispatcher(t)
	recycleDrainTimeout = 50 * time.Millisecond
	d.pendingOutput = func() bool { return true }
	d.maybeRecycle()
	expectExit(t, exits)
}

func TestRecycle_SessionCountsQueuedAndUnacknowledgedOutput(t *testing.T) {
	s := newAgentSession("ws://localhost", "tok", true)
	assert.False(t, s.dispatcher.pendingOutput())
	s.dispatcher.delivery.setEnabled(true)
	s.dispatcher.SendWSEvent("run-1", "result", nil)
	assert.True(t, s.dispatcher.pendingOutput(), "queued")
	ev := (<-s.outChan).(WSEventOut)
	assert.True(t, s.dispatcher.pendingOutput(), "sent, not acknowledged")
	s.dispatcher.delivery.ack("run-1", ev.Exec, ev.Seq)
	assert.False(t, s.dispatcher.pendingOutput())
}

// Wired end to end: a real scan runs to its end, its events drain, and only then the agent exits.
func TestRecycle_AfterARealScanEnds(t *testing.T) {
	safenet.AllowLocalNetwork = true
	defer func() { safenet.AllowLocalNetwork = false }()
	t.Setenv("SWAZZ_DISABLE_TELEMETRY", "true")
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer target.Close()

	out := make(chan interface{}, 1000)
	d := NewAgentDispatcher("ws://localhost", "tok", true, out)
	oldPoll := recyclePollInterval
	recyclePollInterval = 5 * time.Millisecond
	defer func() { recyclePollInterval = oldPoll }()
	exits := make(chan int, 1)
	d.exit = func(code int) { exits <- code }
	d.pendingOutput = func() bool { return len(out) > 0 }
	d.EnableRecycleWhenIdle()

	sawComplete := make(chan struct{})
	go func() {
		for msg := range out {
			if ev, ok := msg.(WSEventOut); ok {
				if p, ok := ev.Payload.(WSEventPayload); ok && p.Type == "complete" {
					close(sawComplete)
				}
			}
		}
	}()

	payload, err := json.Marshal(JobDispatchPayload{
		RunID: "recycle-run",
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

	select {
	case <-exits:
		select {
		case <-sawComplete:
		default:
			t.Fatal("the agent recycled before the scan's completion went out")
		}
	case <-time.After(30 * time.Second):
		t.Fatal("the agent did not recycle after the scan ended")
	}
	close(out)
}
