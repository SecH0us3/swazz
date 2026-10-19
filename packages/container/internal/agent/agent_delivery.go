// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sort"
	"sync"
	"time"
)

// Acknowledged delivery of run events. A WebSocket write that "succeeds" only proves the bytes
// reached the local kernel; on a connection that died half-open they are lost. So every event of
// a run carries a per-run sequence number and stays in the run's log until the coordinator
// acknowledges it ({"type":"ack","runId":..,"exec":..,"seq":N} covers every seq <= N). After a
// reconnect the agent replays whatever is still unacknowledged; the coordinator drops the seqs it
// already has.
//
// Each execution of a run on this agent has its own random exec id, sent with every event, so the
// coordinator tells a new execution (numbered from 1 again) from a replay of the current one
// without having to guess when a dispatch actually started one.
//
// Numbers are assigned in the order events are queued for sending (AgentDispatcher.queueEvent),
// so each run's events reach the wire in sequence order.
//
// The coordinator acknowledges every so many events and terminal ones; for the rest (the tail of
// a run, a run it refuses) the agent asks once the connection has gone quiet (ackRequestMsg).
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
	// ackRequestDelay is how long the connection must stay quiet before the agent asks for
	// acknowledgement of what it sent.
	ackRequestDelay = time.Second
)

type runLog struct {
	exec    string
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

// ackRequestMsg asks the coordinator to acknowledge the run's events up to Seq of execution Exec,
// all of which were written on the current connection.
type ackRequestMsg struct {
	Type  string `json:"type"`
	RunID string `json:"runId"`
	Exec  string `json:"exec"`
	Seq   uint64 `json:"seq"`
}

func newExecID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand does not fail on supported platforms; a time-based id keeps executions apart.
		return fmt.Sprintf("t%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
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

// reset starts a new execution of a run (dispatched to this agent): a new exec id, numbered from 1.
func (l *deliveryLog) reset(runID string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.runs, runID)
}

// stamp gives msg the run's next sequence number and execution id and keeps it until it is
// acknowledged. Callers queue the result under AgentDispatcher.sendMu, so a run's events are
// queued in sequence order.
func (l *deliveryLog) stamp(msg WSEventOut) WSEventOut {
	l.mu.Lock()
	defer l.mu.Unlock()
	rl := l.runs[msg.RunID]
	if rl == nil {
		rl = &runLog{exec: newExecID()}
		l.runs[msg.RunID] = rl
	}
	rl.nextSeq++
	msg.Seq = rl.nextSeq
	msg.Exec = rl.exec
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

// ack forgets every message of the run's execution exec up to and including seq. An ack for an
// earlier execution of the run is ignored.
func (l *deliveryLog) ack(runID, exec string, seq uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	rl := l.runs[runID]
	if rl == nil || rl.exec != exec {
		return
	}
	i := sort.Search(len(rl.unacked), func(i int) bool { return rl.unacked[i].Seq > seq })
	rl.unacked = append([]WSEventOut(nil), rl.unacked[i:]...)
	rl.touched = l.now()
}

// ackRequest returns the request for acknowledgement of the run's execution exec up to seq, or
// false when nothing up to seq is still unacknowledged.
func (l *deliveryLog) ackRequest(runID, exec string, seq uint64) (ackRequestMsg, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	rl := l.runs[runID]
	if rl == nil || rl.exec != exec || len(rl.unacked) == 0 || rl.unacked[0].Seq > seq {
		return ackRequestMsg{}, false
	}
	return ackRequestMsg{Type: "ack_request", RunID: runID, Exec: exec, Seq: seq}, true
}

// unackedRuns lists the runs that still have messages waiting for an acknowledgement, the most
// recently active first.
func (l *deliveryLog) unackedRuns() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	var ids []string
	for id, rl := range l.runs {
		if len(rl.unacked) > 0 {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool {
		ti, tj := l.runs[ids[i]].touched, l.runs[ids[j]].touched
		if !ti.Equal(tj) {
			return ti.After(tj)
		}
		return ids[i] < ids[j]
	})
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
