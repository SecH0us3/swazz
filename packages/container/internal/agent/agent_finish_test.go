// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
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

func closedChan() chan struct{} {
	c := make(chan struct{})
	close(c)
	return c
}

func TestFinishExecution_NothingMoreOnceTheRunReportedItsEnd(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	var sent sentByExecution
	d.finishExecution("run-1", false, func() bool { return true }, closedChan(), sent.sendEvent, sent.sendError)
	assert.Empty(t, sent.events)
	assert.Empty(t, sent.errors)
}

// A run that returned without completing or reporting an error would look like it was still
// running, forever.
func TestFinishExecution_EndsARunThatNeverReportedItsEnd(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	var sent sentByExecution
	d.finishExecution("run-1", false, func() bool { return false }, closedChan(), sent.sendEvent, sent.sendError)
	require.Len(t, sent.errors, 1)
	assert.Contains(t, sent.errors[0], "ended without reporting completion")
	require.Len(t, sent.logs, 1)
	assert.Contains(t, sent.logs[0], sent.errors[0])
}

func TestFinishExecution_PanicIsReportedWithoutInternals(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	var sent sentByExecution
	d.finishExecution("run-1", true, func() bool { return false }, closedChan(), sent.sendEvent, sent.sendError)
	require.Len(t, sent.errors, 1)
	assert.Contains(t, sent.errors[0], "internal error")
	for _, m := range append(sent.errors, sent.logs...) {
		assert.NotContains(t, m, "goroutine")
		assert.NotContains(t, m, ".go:")
	}
}

// Events still being forwarded may include the run's own "complete"; it waits for them, but not
// forever.
func TestFinishExecution_WaitsForForwardingBoundedly(t *testing.T) {
	d := NewAgentDispatcher("ws://localhost", "tok", true, make(chan interface{}, 10))
	old := executionDrainTimeout
	executionDrainTimeout = 50 * time.Millisecond
	defer func() { executionDrainTimeout = old }()

	var sent sentByExecution
	start := time.Now()
	d.finishExecution("run-1", false, func() bool { return false }, make(chan struct{}), sent.sendEvent, sent.sendError)
	assert.Less(t, time.Since(start), time.Second)
	assert.Len(t, sent.errors, 1)

	// The terminal event forwarded while it waited counts.
	sent = sentByExecution{}
	done := make(chan struct{})
	completed := false
	go func() { time.Sleep(10 * time.Millisecond); completed = true; close(done) }()
	d.finishExecution("run-1", false, func() bool { return completed }, done, sent.sendEvent, sent.sendError)
	assert.Empty(t, sent.errors)
}
