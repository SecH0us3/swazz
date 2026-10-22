// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/swagger"
)

func TestLifecycle_PauseResumeStop(t *testing.T) {
	r := &Runner{
		config: &swagger.Config{},
	}
	r.pause.cond = sync.NewCond(&r.pause.mu)

	// When not running, Pause should be a no-op
	assert.False(t, r.IsRunning())
	r.Pause()
	assert.False(t, r.paused())

	// Mark as running
	r.lifecycle.isRunning.Store(true)
	assert.True(t, r.IsRunning())

	// Pause while running
	r.Pause()
	assert.True(t, r.paused())

	// Resume
	r.Resume()
	assert.False(t, r.paused())

	// Pause again, then Stop
	r.Pause()
	assert.True(t, r.paused())

	r.Stop()
	assert.True(t, r.stopped())
	assert.False(t, r.paused())
}

func TestLifecycle_WaitIfPaused_Resume(t *testing.T) {
	r := &Runner{
		config: &swagger.Config{},
	}
	r.pause.cond = sync.NewCond(&r.pause.mu)
	r.lifecycle.isRunning.Store(true)
	r.lifecycle.isPaused.Store(true)

	unblocked := make(chan struct{})
	go func() {
		r.waitIfPaused(context.Background())
		close(unblocked)
	}()

	select {
	case <-unblocked:
		t.Fatal("waitIfPaused unblocked prematurely while paused")
	case <-time.After(50 * time.Millisecond):
		// Expected to remain blocked
	}

	r.Resume()

	select {
	case <-unblocked:
		// Successfully unblocked
	case <-time.After(1 * time.Second):
		t.Fatal("waitIfPaused failed to unblock after Resume")
	}
}

func TestLifecycle_WaitIfPaused_Stop(t *testing.T) {
	r := &Runner{
		config: &swagger.Config{},
	}
	r.pause.cond = sync.NewCond(&r.pause.mu)
	r.lifecycle.isRunning.Store(true)
	r.lifecycle.isPaused.Store(true)

	unblocked := make(chan struct{})
	go func() {
		r.waitIfPaused(context.Background())
		close(unblocked)
	}()

	select {
	case <-unblocked:
		t.Fatal("waitIfPaused unblocked prematurely while paused")
	case <-time.After(50 * time.Millisecond):
		// Expected to remain blocked
	}

	r.Stop()

	select {
	case <-unblocked:
		// Successfully unblocked by Stop
	case <-time.After(1 * time.Second):
		t.Fatal("waitIfPaused failed to unblock after Stop")
	}
}

func TestLifecycle_Close_CleanShutdown(t *testing.T) {
	cfg := &swagger.Config{
		Settings: swagger.Settings{TimeoutMs: 1000},
	}
	r := New(cfg, nil)
	require.NotNil(t, r)

	subCh := r.Subscribe()
	require.NotNil(t, subCh)

	ctx, cancel := context.WithCancel(context.Background())
	r.lifecycle.mu.Lock()
	r.lifecycle.cancel = cancel
	r.lifecycle.mu.Unlock()

	// Calling Close should clean up everything
	r.Close()

	// Ensure context was cancelled
	assert.ErrorIs(t, ctx.Err(), context.Canceled)

	// Calling Close a second time should not panic
	assert.NotPanics(t, func() {
		r.Close()
	})
}

// A hold keeps the main loop waiting whatever the user's pause does, and only Release (or Stop)
// lets it go on.
func TestLifecycle_HoldOutlastsTheUsersResume(t *testing.T) {
	r := &Runner{config: &swagger.Config{}}
	r.pause.cond = sync.NewCond(&r.pause.mu)
	r.lifecycle.isRunning.Store(true)

	r.Hold()
	require.True(t, r.Held())
	unblocked := make(chan struct{})
	go func() {
		r.waitIfPaused(context.Background())
		close(unblocked)
	}()

	r.Pause()
	r.Resume() // the user's resume does not end the hold
	select {
	case <-unblocked:
		t.Fatal("a held runner went on after the user's resume")
	case <-time.After(50 * time.Millisecond):
	}

	r.Release()
	select {
	case <-unblocked:
	case <-time.After(2 * time.Second):
		t.Fatal("Release did not let the runner go on")
	}
	assert.False(t, r.Held())

	// Stop ends a wait under a hold too.
	r.Hold()
	stopped := make(chan struct{})
	go func() {
		r.waitIfPaused(context.Background())
		close(stopped)
	}()
	r.Stop()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not end a held wait")
	}
}

// Every request of every phase waits out a hold: not only the main loops check it.
func TestLifecycle_RequestsWaitWhileHeld(t *testing.T) {
	r := &Runner{config: &swagger.Config{}}
	r.pause.cond = sync.NewCond(&r.pause.mu)

	r.waitWhileHeld(context.Background()) // not held: returns at once

	r.Hold()
	released := make(chan struct{})
	go func() {
		r.waitWhileHeld(context.Background())
		close(released)
	}()
	select {
	case <-released:
		t.Fatal("a request went out under a hold")
	case <-time.After(50 * time.Millisecond):
	}
	r.Release()
	select {
	case <-released:
	case <-time.After(2 * time.Second):
		t.Fatal("Release did not let the request go")
	}

	// A request whose context ends stops waiting.
	r.Hold()
	ctx, cancel := context.WithCancel(context.Background())
	cancelled := make(chan struct{})
	go func() {
		r.waitWhileHeld(ctx)
		close(cancelled)
	}()
	cancel()
	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("a cancelled request kept waiting")
	}

	// And Stop ends it too.
	stopped := make(chan struct{})
	go func() {
		r.waitWhileHeld(context.Background())
		close(stopped)
	}()
	r.Stop()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not end a held request")
	}
}

// executeRequest is the gate: a held runner sends nothing.
func TestExecuteRequest_WaitsWhileHeld(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { hits.Add(1) }))
	defer srv.Close()
	r := &Runner{client: srv.Client(), config: &swagger.Config{BaseURL: srv.URL, Settings: swagger.Settings{TimeoutMs: 5000}}}
	r.pause.cond = sync.NewCond(&r.pause.mu)
	r.Hold()
	done := make(chan struct{})
	go func() {
		r.executeRequest(context.Background(), srv.URL, "/x", "/x", "GET", nil, nil, nil, swagger.ProfileRandom, nil, nil, "")
		close(done)
	}()
	time.Sleep(50 * time.Millisecond)
	assert.Zero(t, hits.Load(), "sent under a hold")
	r.Release()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the request never went out")
	}
	assert.Equal(t, int32(1), hits.Load())

	// Stopped while held: nothing is sent, and the result says so instead of passing for a timeout.
	r.Hold()
	results := make(chan *swagger.FuzzResult, 1)
	go func() {
		results <- r.executeRequest(context.Background(), srv.URL, "/x", "/x", "GET", nil, nil, nil, swagger.ProfileRandom, nil, nil, "")
	}()
	time.Sleep(20 * time.Millisecond)
	r.Stop()
	select {
	case res := <-results:
		assert.Contains(t, res.Error, "not sent")
	case <-time.After(5 * time.Second):
		t.Fatal("a stopped held request kept waiting")
	}
	assert.Equal(t, int32(1), hits.Load())
}

// A main loop paused or held stops waiting once its context ends, without Stop: a held agent
// shutting down must not hang its scans.
func TestLifecycle_WaitIfPausedEndsWithItsContext(t *testing.T) {
	r := &Runner{config: &swagger.Config{}}
	r.pause.cond = sync.NewCond(&r.pause.mu)
	r.Hold()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		r.waitIfPaused(ctx)
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("went on while held")
	case <-time.After(50 * time.Millisecond):
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("a cancelled main loop kept waiting")
	}
}

// A request the scan stopped before sending is not a result: it is not counted or streamed.
func TestSendStats_DropsRequestsNotSent(t *testing.T) {
	r := &Runner{}
	assert.True(t, notSent(&swagger.FuzzResult{Error: errNotSentWhileHeld}))
	assert.False(t, notSent(&swagger.FuzzResult{Error: "Request timed out"}))
	assert.False(t, notSent(nil))
	assert.False(t, r.sendStats(statsMsg{result: &swagger.FuzzResult{Error: errNotSentWhileHeld}}))
}
