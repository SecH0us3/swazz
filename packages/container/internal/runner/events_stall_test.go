// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/swagger"
)

func events(evts ...Event) *EventNode {
	var head *EventNode
	for i := len(evts) - 1; i >= 0; i-- {
		head = &EventNode{Value: evts[i], Next: head}
	}
	return head
}

// drainUntil reads ch until an event with the given data arrives, skipping others (runner logs).
func drainUntil(t *testing.T, ch chan Event, data string) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case evt := <-ch:
			if evt.Data == data {
				return
			}
		case <-deadline:
			t.Fatalf("event %q never arrived", data)
		}
	}
}

// A subscriber that once fell behind gets events again once it catches up, instead of losing
// every result until the end of the scan; it never gets a checkpoint past the results it missed.
func TestProcessEvents_StalledSubscriberRecovers(t *testing.T) {
	old := criticalSendTimeout
	criticalSendTimeout = 20 * time.Millisecond
	t.Cleanup(func() { criticalSendTimeout = old })

	r := New(&swagger.Config{}, nil)
	defer r.Close()
	ch := r.Subscribe()
	defer r.Unsubscribe(ch)
	for len(ch) < cap(ch) {
		ch <- Event{Type: EventProgress, Data: "filler"}
	}

	lagging := map[chan Event]*subLag{}
	r.processEvents(events(Event{Type: EventResult, Data: "r1"}), lagging)
	require.NotNil(t, lagging[ch])
	require.True(t, lagging[ch].stalled, "a full subscriber is marked stalled")

	// While stalled, a critical event is only offered (no wait) and counted when missed.
	criticalSendTimeout = 10 * time.Second
	start := time.Now()
	r.processEvents(events(Event{Type: EventResult, Data: "r2"}, Event{Type: EventError, Data: "e1"}), lagging)
	assert.Less(t, time.Since(start), 5*time.Second, "a stalled subscriber held up the broadcast")
	assert.Equal(t, 3, lagging[ch].dropped)

	// One freed slot is not enough to recover: a subscriber that stays slow stays stalled.
	<-ch
	r.processEvents(events(Event{Type: EventResult, Data: "r3"}), lagging)
	assert.True(t, lagging[ch].stalled)
	assert.Equal(t, 4, lagging[ch].dropped)

	// It catches up: the next result is delivered, and it is no longer stalled.
	for len(ch) > 0 {
		<-ch
	}
	r.processEvents(events(Event{Type: EventResult, Data: "r4"}), lagging)
	assert.False(t, lagging[ch].stalled)
	drainUntil(t, ch, "r4")

	// But a checkpoint never reaches it again: it would mark r1..r3 as done.
	r.processEvents(events(Event{Type: EventCheckpoint, Data: "c1"}, Event{Type: EventResult, Data: "r5"}), lagging)
	select {
	case evt := <-ch:
		assert.Equal(t, "r5", evt.Data, "a checkpoint reached a subscriber that missed results")
	case <-time.After(time.Second):
		t.Fatal("r5 never arrived")
	}
}

// A stalled subscriber gets no progress or log events, which would take the room its results need.
func TestProcessEvents_StalledSubscriberGetsNoNonCriticalEvents(t *testing.T) {
	r := New(&swagger.Config{}, nil)
	defer r.Close()
	ch := r.Subscribe()
	defer r.Unsubscribe(ch)

	lagging := map[chan Event]*subLag{ch: {stalled: true, dropped: 1}}
	r.processEvents(events(Event{Type: EventProgress, Data: "p"}), lagging)
	assert.Zero(t, len(ch))
}

// The lagging set does not keep the channels of subscribers that have gone.
func TestProcessEvents_ForgetsUnsubscribedStalledSubscribers(t *testing.T) {
	r := New(&swagger.Config{}, nil)
	defer r.Close()
	gone := r.Subscribe()
	lagging := map[chan Event]*subLag{gone: {stalled: true, dropped: 1}}
	r.Unsubscribe(gone)

	r.processEvents(events(Event{Type: EventProgress, Data: "p"}), lagging)
	assert.Empty(t, lagging)
}
