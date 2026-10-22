// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// events.go: Manages the real-time event system for progress reporting.
// It handles SSE (Server-Sent Events) subscribers, message broadcasting,
// and ensures critical events are delivered to the dashboard.

package runner

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"swazz-engine/internal/logger"
)

// Event types for SSE streaming.
const (
	EventResult     = "result"
	EventProgress   = "progress"
	EventComplete   = "complete"
	EventError      = "error"
	EventCheckpoint = "checkpoint"
)

// Event represents a streaming event sent to subscribers.
type Event struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

var bufPool = sync.Pool{
	New: func() any {
		return new(bytes.Buffer)
	},
}

// PutBuffer safely resets and returns a buffer to the pool if its capacity is reasonable (<= 64KB),
// preventing oversized buffers from pinning memory indefinitely in the heap.
func PutBuffer(buf *bytes.Buffer) {
	if buf == nil {
		return
	}
	if buf.Cap() <= 64*1024 {
		buf.Reset()
		bufPool.Put(buf)
	}
}

// JSON serializes the event data.
func (e *Event) JSON() string {
	b, err := json.Marshal(e.Data)
	if err != nil {
		// Cannot use r.logError here since it recursively calls Broadcast, causing infinite loop.
		// Instead just print to console.
		fmt.Printf("Failed to marshal event data for type %s: %v\n", e.Type, err)
		return `{"error": "failed to marshal event data on server"}`
	}
	return string(b)
}

// Subscribe returns a channel for receiving live events.
func (r *Runner) Subscribe() chan Event {
	ch := make(chan Event, 512)
	r.subsMu.Lock()
	r.subs[ch] = struct{}{}
	r.subsMu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber channel safely, avoiding double-close panic.
func (r *Runner) Unsubscribe(ch chan Event) {
	r.subsMu.Lock()
	defer r.subsMu.Unlock()
	if _, exists := r.subs[ch]; exists {
		delete(r.subs, ch)
		func() {
			defer func() { _ = recover() }()
			close(ch)
		}()
	}
}

func (r *Runner) Broadcast(evt Event) {
	r.eventQueue.Push(evt)
}

// subLag is the delivery state of a subscriber that once missed a critical event: it did not take
// one within criticalSendTimeout.
//   - While stalled, critical events are only offered to it without waiting (one stuck subscriber
//     must not hold up the others for criticalSendTimeout per event), the ones it misses are
//     counted, and it gets no non-critical events, which would take the room critical ones need.
//   - It is no longer stalled once its buffer is at most half full and it takes a critical event:
//     the headroom keeps a subscriber that stays slow from going back to the blocking send, and
//     its timeout, on every freed slot.
//   - It never gets a checkpoint again (gap): a checkpoint after missed results would let a
//     resumed scan skip them for good.
type subLag struct {
	stalled bool
	dropped int
}

// criticalSendTimeout is how long a critical event waits for a subscriber that is not stalled.
var criticalSendTimeout = 2 * time.Second

func (r *Runner) broadcastLoop() {
	if r.broadcastDone != nil {
		defer close(r.broadcastDone)
	}
	lagging := make(map[chan Event]*subLag)

	for {
		select {
		case <-r.doneCh:
			// Drain remaining events before exiting
			r.processEvents(r.eventQueue.PopAll(), lagging)
			return
		case <-r.eventQueue.WaitChan():
			r.processEvents(r.eventQueue.PopAll(), lagging)
		}
	}
}

func isCriticalEvent(evt Event) bool {
	return evt.Type == EventResult || evt.Type == EventComplete || evt.Type == EventError || evt.Type == EventCheckpoint
}

func (r *Runner) processEvents(nodes *EventNode, lagging map[chan Event]*subLag) {
	if nodes == nil {
		return
	}

	r.subsMu.RLock()
	defer r.subsMu.RUnlock()

	// Forget subscribers that have unsubscribed: the map must not keep their channels.
	for ch := range lagging {
		if _, ok := r.subs[ch]; !ok {
			delete(lagging, ch)
		}
	}

	for nodes != nil {
		evt := nodes.Value
		nodes = nodes.Next

		for ch := range r.subs {
			lag := lagging[ch]
			if !isCriticalEvent(evt) {
				// Non-critical events (like progress stats) can be dropped if the client is too slow.
				if lag == nil || !lag.stalled {
					safeSendNonBlocking(ch, evt)
				}
				continue
			}
			if lag != nil && evt.Type == EventCheckpoint {
				continue
			}

			if lag != nil && lag.stalled {
				if len(ch) > cap(ch)/2 || !safeSendNonBlocking(ch, evt) {
					lag.dropped++
					continue
				}
				lag.stalled = false
				// Local log only: an event for the user's runner log would be queued behind the
				// very backlog it reports on.
				logger.Warn("[Runner] A live event subscriber caught up after missing %d event(s) (results, or the run's end); checkpoints stay off for it", lag.dropped)
				lag.dropped = 0
				continue
			}

			// Critical events MUST be delivered, but with a timeout to prevent OOM
			// if a client stalls indefinitely.
			if !safeSend(ch, evt, criticalSendTimeout) {
				if lag == nil {
					lag = &subLag{}
					lagging[ch] = lag
				}
				lag.stalled = true
				lag.dropped = 1
				logger.Warn("[Runner] A live event subscriber did not take a %s event for %v; dropping its events until it catches up", evt.Type, criticalSendTimeout)
			}
		}
	}
}

// safeSend attempts to write to a channel with a timeout.
// It safely recovers from panics if the channel is closed concurrently.
func safeSend(ch chan Event, evt Event, timeout time.Duration) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			ok = false
		}
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case ch <- evt:
		return true
	case <-timer.C:
		return false
	}
}

// safeSendNonBlocking attempts to write to a channel without blocking.
// It safely recovers from panics if the channel is closed concurrently.
func safeSendNonBlocking(ch chan Event, evt Event) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			ok = false
		}
	}()

	select {
	case ch <- evt:
		return true
	default:
		return false
	}
}
