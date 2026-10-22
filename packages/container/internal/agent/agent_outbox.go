// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import "sync"

// The outbox is the agent's queue of messages for the coordinator, ahead of the connection's
// write loop. It exists so that no scan blocks on a coordinator that is away:
//
//   - adding to it never blocks below hardOutboxLimit (and never under AgentDispatcher.sendMu,
//     which numbers run events), so a run goroutine keeps taking its runner's events;
//   - past highOutboxMark the dispatcher holds every scan (runner.Hold: no new requests) until
//     the queue is back under lowOutboxMark, so an outage pauses scans instead of dropping their
//     events;
//   - it is first in, first out, and only its pump moves messages on (to the session's outChan),
//     so a run's events reach the wire in sequence order.
//
// Past highOutboxMark only what was already in flight is added (each held scan's running
// requests, a post-scan phase): hardOutboxLimit bounds that, and a sender past it waits, without
// holding any lock, until the queue drains (senders that pass that check together may each add
// one more). Nothing is dropped.
const (
	highOutboxMark  = 20000
	lowOutboxMark   = 10000
	hardOutboxLimit = 100000
)

type outbox struct {
	mu    sync.Mutex
	items []interface{}
	// inFlight counts messages the pump has taken but not yet handed on: still pending.
	inFlight int
	ready    chan struct{} // signalled (cap 1) when items were added
	room     chan struct{} // closed when the queue drops below hardLimit; nil while nobody waits

	high, low, hardLimit int
}

func newOutbox() *outbox {
	return &outbox{ready: make(chan struct{}, 1), high: highOutboxMark, low: lowOutboxMark, hardLimit: hardOutboxLimit}
}

// waitRoom waits while the queue is at hardLimit. It holds no lock while it waits.
func (o *outbox) waitRoom() {
	for {
		o.mu.Lock()
		if len(o.items) < o.hardLimit {
			o.mu.Unlock()
			return
		}
		if o.room == nil {
			o.room = make(chan struct{})
		}
		room := o.room
		o.mu.Unlock()
		<-room
	}
}

// push adds msg at the back of the queue, never blocking, and reports whether the queue (with
// the message in flight) has reached its high mark.
func (o *outbox) push(msg interface{}) (full bool) {
	o.mu.Lock()
	o.items = append(o.items, msg)
	full = len(o.items)+o.inFlight >= o.high
	o.mu.Unlock()
	select {
	case o.ready <- struct{}{}:
	default:
	}
	return full
}

// take removes the message at the front, waiting for one; false once stop is closed. The caller
// hands it on and then calls handed.
func (o *outbox) take(stop <-chan struct{}) (interface{}, bool) {
	for {
		o.mu.Lock()
		if len(o.items) > 0 {
			msg := o.items[0]
			o.items[0] = nil
			o.items = o.items[1:]
			if len(o.items) == 0 {
				o.items = nil // let the backing array go
			}
			o.inFlight++
			if o.room != nil && len(o.items) < o.hardLimit {
				close(o.room)
				o.room = nil
			}
			o.mu.Unlock()
			return msg, true
		}
		o.mu.Unlock()
		select {
		case <-o.ready:
		case <-stop:
			return nil, false
		}
	}
}

// handed records that a message from take was handed on, and reports whether the queue is down
// to its low mark.
func (o *outbox) handed() (drained bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.inFlight--
	return len(o.items) <= o.low
}

// queued is the number of messages waiting in the queue, not counting the one in flight.
func (o *outbox) queued() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.items)
}

// pending is the number of messages queued or in flight.
func (o *outbox) pending() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.items) + o.inFlight
}

// pump moves the outbox, in order, into out, which the connection's write loop drains, until
// stop is closed. onDrained runs whenever a hand-off leaves the queue at its low mark or under.
func (o *outbox) pump(out chan<- interface{}, stop <-chan struct{}, onDrained func()) {
	for {
		msg, ok := o.take(stop)
		if !ok {
			return
		}
		select {
		case out <- msg:
		case <-stop:
			return
		}
		if o.handed() {
			onDrained()
		}
	}
}
