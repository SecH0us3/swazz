// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"time"

	swazzGrpc "swazz-engine/internal/grpc"
	"swazz-engine/internal/logger"
)

// Close stops the background broadcast loop and cancels any active run.
func (r *Runner) Close() {
	r.lifecycle.mu.Lock()
	if r.lifecycle.cancel != nil {
		r.lifecycle.cancel()
	}
	r.lifecycle.mu.Unlock()
	if r.doneCh != nil {
		select {
		case <-r.doneCh:
		default:
			close(r.doneCh)
		}
	}
	if r.broadcastDone != nil {
		select {
		case <-r.broadcastDone:
		case <-time.After(1 * time.Second):
		}
	}
	if r.client != nil {
		r.client.CloseIdleConnections()
	}
	r.grpcClients.Range(func(key, value any) bool {
		if c, ok := value.(*swazzGrpc.Client); ok {
			if err := c.Close(); err != nil {
				logger.Debug("[Runner] Error closing gRPC client for %v: %v", key, err)
			}
		}
		return true
	})
	r.wsClients.Range(func(key, value any) bool {
		if c, ok := value.(interface{ Close() error }); ok {
			_ = c.Close()
		}
		return true
	})
	r.subsMu.Lock()
	for ch := range r.subs {
		delete(r.subs, ch)
		func() {
			defer func() { _ = recover() }()
			close(ch)
		}()
	}
	r.subsMu.Unlock()
}

// Stop signals the runner to halt after the current request completes.
func (r *Runner) Stop() {
	r.lifecycle.shouldStop.Store(true)
	r.lifecycle.isPaused.Store(false)
	r.lifecycle.mu.Lock()
	if r.lifecycle.cancel != nil {
		r.lifecycle.cancel()
	}
	r.lifecycle.mu.Unlock()
	r.pause.cond.Broadcast()
}

// Pause temporarily suspends dispatching new requests.
func (r *Runner) Pause() {
	if r.lifecycle.isRunning.Load() {
		r.lifecycle.isPaused.Store(true)
	}
}

// Resume resumes a paused runner.
func (r *Runner) Resume() {
	r.lifecycle.isPaused.Store(false)
	r.pause.cond.Broadcast()
}

// IsRunning reports whether the runner is currently executing a fuzz run.
func (r *Runner) IsRunning() bool { return r.lifecycle.isRunning.Load() }

// waitIfPaused blocks the calling goroutine until the runner is resumed or
// stopped. It must only be called from the main iteration loop (single writer).
func (r *Runner) waitIfPaused() {
	r.pause.mu.Lock()
	for r.lifecycle.isPaused.Load() && !r.lifecycle.shouldStop.Load() {
		r.pause.cond.Wait()
	}
	r.pause.mu.Unlock()
}

func (r *Runner) stopped() bool { return r.lifecycle.shouldStop.Load() }

func (r *Runner) paused() bool { return r.lifecycle.isPaused.Load() }
