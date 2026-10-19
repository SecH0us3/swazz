// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"sort"
	"sync"
	"time"
)

// Acknowledged delivery of run events. A WebSocket write that "succeeds" only proves the bytes
// reached the local kernel; on a connection that died half-open they are lost. So every event of
// a run carries a per-run sequence number and stays in the run's log until the coordinator
// acknowledges it ({"type":"ack","runId":..,"seq":N} covers every seq <= N). After a reconnect the
// agent replays whatever is still unacknowledged; the coordinator drops the seqs it already has.
//
// Only a coordinator that announces support (deliveryHeader on the WebSocket upgrade response)
// acknowledges anything; with any other the log keeps nothing and replays nothing.
//
// Bounds: at most maxUnackedPerRun messages are kept per run (the oldest are dropped beyond that,
// which the coordinator sees as a gap), and the log of a run that is no longer executing is
// discarded once it has been idle for idleRunLogTTL.

// deliveryHeader is set to "ack" by coordinators that acknowledge run events.
const deliveryHeader = "X-Swazz-Delivery"

const (
	maxUnackedPerRun = 10000
	idleRunLogTTL    = 15 * time.Minute
)

type runLog struct {
	nextSeq uint64
	unacked []WSEventOut
	touched time.Time
	dropped bool
}

type deliveryLog struct {
	mu      sync.Mutex
	runs    map[string]*runLog
	now     func() time.Time
	enabled bool
}

func newDeliveryLog() *deliveryLog {
	return &deliveryLog{runs: make(map[string]*runLog), now: time.Now}
}

// setEnabled records whether the current coordinator acknowledges events. Without acks nothing
// is retained: the messages would only pile up and be replayed as duplicates.
func (l *deliveryLog) setEnabled(enabled bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.enabled = enabled
	if !enabled {
		for _, rl := range l.runs {
			rl.unacked = nil
		}
	}
}

// reset starts a fresh sequence for a run that is (re)dispatched to this agent.
func (l *deliveryLog) reset(runID string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.runs, runID)
}

// stamp gives msg the run's next sequence number and keeps it until it is acknowledged.
func (l *deliveryLog) stamp(msg WSEventOut) WSEventOut {
	l.mu.Lock()
	defer l.mu.Unlock()
	rl := l.runs[msg.RunID]
	if rl == nil {
		rl = &runLog{}
		l.runs[msg.RunID] = rl
	}
	rl.nextSeq++
	msg.Seq = rl.nextSeq
	rl.touched = l.now()
	if !l.enabled {
		return msg
	}
	rl.unacked = append(rl.unacked, msg)
	if len(rl.unacked) > maxUnackedPerRun {
		if !rl.dropped {
			logError("Run %s: more than %d events are unacknowledged; dropping the oldest", msg.RunID, maxUnackedPerRun)
			rl.dropped = true
		}
		rl.unacked = rl.unacked[len(rl.unacked)-maxUnackedPerRun:]
	}
	return msg
}

// ack forgets every message of the run up to and including seq.
func (l *deliveryLog) ack(runID string, seq uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	rl := l.runs[runID]
	if rl == nil {
		return
	}
	i := sort.Search(len(rl.unacked), func(i int) bool { return rl.unacked[i].Seq > seq })
	rl.unacked = append([]WSEventOut(nil), rl.unacked[i:]...)
	rl.touched = l.now()
}

// unackedRuns lists the runs that still have messages waiting for an acknowledgement.
func (l *deliveryLog) unackedRuns() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	var ids []string
	for id, rl := range l.runs {
		if len(rl.unacked) > 0 {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

// replay returns the unacknowledged messages of every run, each run's in sequence order.
func (l *deliveryLog) replay() []WSEventOut {
	l.mu.Lock()
	defer l.mu.Unlock()
	ids := make([]string, 0, len(l.runs))
	for id := range l.runs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var out []WSEventOut
	for _, id := range ids {
		out = append(out, l.runs[id].unacked...)
	}
	return out
}

// gc discards the logs of runs that no longer execute here and have been idle for idleRunLogTTL.
func (l *deliveryLog) gc(isActive func(runID string) bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := l.now().Add(-idleRunLogTTL)
	for id, rl := range l.runs {
		if rl.touched.Before(cutoff) && !isActive(id) {
			delete(l.runs, id)
		}
	}
}
