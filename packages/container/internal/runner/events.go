package runner

import (
	"bytes"
	"encoding/json"
	"sync"
	"time"
)

// Event types for SSE streaming.
const (
	EventResult   = "result"
	EventProgress = "progress"
	EventComplete = "complete"
	EventError    = "error"
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

// JSON serializes the event data.
func (e *Event) JSON() string {
	b, _ := json.Marshal(e.Data)
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
	_, exists := r.subs[ch]
	if exists {
		delete(r.subs, ch)
		close(ch)
	}
	r.subsMu.Unlock()
}

func (r *Runner) Broadcast(evt Event) {
	r.eventQueue.Push(evt)
}

func (r *Runner) broadcastLoop() {
	stalledSubs := make(map[chan Event]bool)

	for {
		select {
		case <-r.doneCh:
			// Drain remaining events before exiting
			r.processEvents(r.eventQueue.PopAll(), stalledSubs)
			return
		case <-r.eventQueue.WaitChan():
			r.processEvents(r.eventQueue.PopAll(), stalledSubs)
		}
	}
}

func (r *Runner) processEvents(nodes *EventNode, stalledSubs map[chan Event]bool) {
	if nodes == nil {
		return
	}

	r.subsMu.RLock()
	subs := make([]chan Event, 0, len(r.subs))
	for ch := range r.subs {
		subs = append(subs, ch)
	}
	r.subsMu.RUnlock()

	for nodes != nil {
		evt := nodes.Value
		nodes = nodes.Next

		for _, ch := range subs {
			if stalledSubs[ch] {
				continue
			}

			if evt.Type == EventResult || evt.Type == EventComplete || evt.Type == EventError {
				// Critical events MUST be delivered, but with a timeout to prevent OOM
				// if a client stalls indefinitely.
				if !safeSend(ch, evt, 5*time.Second) {
					stalledSubs[ch] = true
					r.Unsubscribe(ch)
				}
			} else {
				// Non-critical events (like progress stats) can be dropped if the client is too slow.
				select {
				case ch <- evt:
				default:
					// Drop event for this specific slow client
				}
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

	select {
	case ch <- evt:
		return true
	case <-time.After(timeout):
		return false
	}
}
