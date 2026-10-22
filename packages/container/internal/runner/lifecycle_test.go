// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"sync"
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
		r.waitIfPaused()
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
		r.waitIfPaused()
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
		r.waitIfPaused()
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
		r.waitIfPaused()
		close(stopped)
	}()
	r.Stop()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not end a held wait")
	}
}
