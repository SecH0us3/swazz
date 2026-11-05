// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type sentByExecution struct {
	events []string
	logs   []string
	errors []string
}

func (s *sentByExecution) sendEvent(typ string, payload interface{}) {
	s.events = append(s.events, typ)
	if typ == "runner_log" {
		s.logs = append(s.logs, payload.(map[string]interface{})["message"].(string))
	}
}

func (s *sentByExecution) sendError(msg string) { s.errors = append(s.errors, msg) }

func noStats() interface{} { return nil }

func closedChan() chan struct{} {
	c := make(chan struct{})
	close(c)
	return c
}

func TestFinishExecution_NothingMoreOnceTheRunReportedItsEnd(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	t.Cleanup(d.Close)
	var sent sentByExecution
	d.finishExecution("run-1", false, func() bool { return true }, closedChan(), noStats, sent.sendEvent, sent.sendError)
	assert.Empty(t, sent.events)
	assert.Empty(t, sent.errors)
}

// A run that returned normally but whose "complete" never made it (dropped by a stalled forwarder,
// or still queued) would look like it was still running, forever; nor did it fail, so it is
// reported complete, with the runner's final stats.
func TestFinishExecution_ReportsCompletionThatWasNotForwarded(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	t.Cleanup(d.Close)
	var sent sentByExecution
	var payload interface{}
	sendEvent := func(typ string, p interface{}) { sent.sendEvent(typ, p); payload = p }
	d.finishExecution("run-1", false, func() bool { return false }, closedChan(), func() interface{} { return map[string]int{"totalRequests": 7} }, sendEvent, sent.sendError)
	assert.Equal(t, []string{"complete"}, sent.events)
	assert.Equal(t, map[string]int{"totalRequests": 7}, payload)
	assert.Empty(t, sent.errors, "a run that finished must not be reported as failed")
}

func TestFinishExecution_PanicIsReportedWithoutInternals(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	t.Cleanup(d.Close)
	var sent sentByExecution
	d.finishExecution("run-1", true, func() bool { return false }, closedChan(), noStats, sent.sendEvent, sent.sendError)
	require.Len(t, sent.errors, 1)
	assert.Contains(t, sent.errors[0], "internal error")
	for _, m := range append(sent.errors, sent.logs...) {
		assert.NotContains(t, m, "goroutine")
		assert.NotContains(t, m, ".go:")
	}
}

// Events still being forwarded may include the run's own "complete": it waits for them, however
// long (a "complete" of its own could not get out sooner), and sends nothing more if it came.
func TestFinishExecution_WaitsForForwardingToFinish(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	t.Cleanup(d.Close)
	var sent sentByExecution
	done := make(chan struct{})
	var completed atomic.Bool
	finished := make(chan struct{})
	go func() {
		d.finishExecution("run-1", false, completed.Load, done, noStats, sent.sendEvent, sent.sendError)
		close(finished)
	}()
	select {
	case <-finished:
		t.Fatal("it must not report the end while events are still being forwarded")
	case <-time.After(100 * time.Millisecond):
	}
	completed.Store(true)
	close(done)
	<-finished
	assert.Empty(t, sent.events)
}
