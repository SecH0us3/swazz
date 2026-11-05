// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/swagger"
)

func TestHandleOOBTrigger(t *testing.T) {
	// Setup Runner with config
	cfg := &swagger.Config{
		RunID: "test-run-id",
		Settings: swagger.Settings{
			OOBServerURL: "https://swazz.secmy.app",
		},
	}
	r := New(cfg, nil)
	defer r.Close()

	// Subscribe to runner events
	events := r.Subscribe()
	defer r.Unsubscribe(events)

	// Register a dummy OOB context
	uuid := "oob-test-uuid-999"
	ctx := &oob.OOBContext{
		SessionID: "session-1",
		Endpoint:  "POST /api/user",
		Payload:   "curl https://swazz.secmy.app/api/oob/test-run-id/oob-test-uuid-999",
		Request: &swagger.RequestLog{
			Method:       "POST",
			ResolvedPath: "/api/user",
			Headers:      map[string]string{"Content-Type": "application/json"},
		},
	}
	r.oobStore.RegisterUUID(uuid, ctx)

	// Call HandleOOBTrigger
	r.HandleOOBTrigger(uuid)

	// Verify we receive the result event with the finding
	select {
	case ev, ok := <-events:
		assert.True(t, ok)
		assert.Equal(t, EventResult, ev.Type)

		res, ok := ev.Data.(*swagger.FuzzResultSSE)
		assert.True(t, ok)
		assert.Equal(t, "POST", res.Method)
		assert.Equal(t, "/api/user", res.ResolvedPath)
		assert.Equal(t, "/api/user", res.Endpoint)
		assert.Equal(t, "oob-"+uuid, res.ID)

		// The SSE object in the event contains payload preview and finding flags
		assert.Contains(t, res.PayloadPreview, "oob-test-uuid-999")
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for OOB event")
	}

	// Triggering the same UUID again should do nothing (already removed)
	r.HandleOOBTrigger(uuid)
	select {
	case <-events:
		t.Fatal("Expected no second event for same UUID")
	case <-time.After(100 * time.Millisecond):
		// OK
	}
}

func TestHandleOOBTrigger_MissingRequest(t *testing.T) {
	cfg := &swagger.Config{
		RunID: "test-run-id-2",
	}
	r := New(cfg, nil)
	defer r.Close()

	events := r.Subscribe()
	defer r.Unsubscribe(events)

	// Context with no Request (Request is nil)
	uuid := "oob-test-uuid-888"
	ctx := &oob.OOBContext{
		SessionID: "session-2",
		Endpoint:  "GET /api/status",
		Payload:   "http://localhost:8080/api/oob/test-run-id-2/oob-test-uuid-888",
		Request:   nil,
	}
	r.oobStore.RegisterUUID(uuid, ctx)

	r.HandleOOBTrigger(uuid)

	select {
	case ev, ok := <-events:
		assert.True(t, ok)
		assert.Equal(t, EventResult, ev.Type)

		res, ok := ev.Data.(*swagger.FuzzResultSSE)
		assert.True(t, ok)
		assert.Equal(t, "GET", res.Method)
		assert.Equal(t, "/api/status", res.ResolvedPath)
		assert.Equal(t, "/api/status", res.Endpoint)
		assert.Equal(t, "oob-"+uuid, res.ID)
	case <-time.After(2 * time.Second):
		t.Fatal("Timeout waiting for OOB event")
	}
}

func TestHandleOOBTrigger_NotFound(t *testing.T) {
	cfg := &swagger.Config{
		RunID: "test-run-id-3",
	}
	r := New(cfg, nil)
	defer r.Close()

	events := r.Subscribe()
	defer r.Unsubscribe(events)

	// Call HandleOOBTrigger with a UUID that does not exist
	r.HandleOOBTrigger("non-existent-uuid")

	select {
	case <-events:
		t.Fatal("Expected no event for non-existent UUID")
	case <-time.After(100 * time.Millisecond):
		// OK
	}
}

// A run that ends with OOB tokens still unanswered hands them over in batches, before its end
// event: the coordinator accepts none of the run's events after that.
func TestFinalise_HandsOverPendingOOBTokensBeforeComplete(t *testing.T) {
	r := New(&swagger.Config{Endpoints: []swagger.EndpointConfig{{Method: "GET", Path: "/a"}}}, nil)
	defer r.Close()
	r.HandOverOOBTokens()
	_, err := r.initRun(context.Background())
	require.NoError(t, err)
	for i := range oobPendingBatchSize + 5 {
		r.oobStore.RegisterUUID(fmt.Sprintf("tok-%d", i), &oob.OOBContext{Endpoint: "GET /a", Payload: "http://x/{{OOB_URL}}"})
	}
	sub := r.Subscribe()
	r.finaliseRun()

	types, _ := runEvents(t, sub)
	require.Contains(t, types, EventComplete)
	complete := 0
	for i, typ := range types {
		if typ == EventComplete {
			complete = i
		}
	}
	batches := 0
	for i, typ := range types {
		if typ == EventOOBPending {
			batches++
			assert.Less(t, i, complete, "a batch came after the end event")
		}
	}
	assert.Equal(t, 2, batches)
}

func TestFinalise_NoPendingOOBEventWithoutTokens(t *testing.T) {
	r := New(&swagger.Config{Endpoints: []swagger.EndpointConfig{{Method: "GET", Path: "/a"}}}, nil)
	defer r.Close()
	r.HandOverOOBTokens()
	_, err := r.initRun(context.Background())
	require.NoError(t, err)
	sub := r.Subscribe()
	r.finaliseRun()
	types, _ := runEvents(t, sub)
	assert.NotContains(t, types, EventOOBPending)
}

// A run whose callbacks do not reach the coordinator (CLI mode, another OOB server) hands nothing
// over: nothing could report a later callback.
func TestFinalise_NoHandOverUnlessEnabled(t *testing.T) {
	r := New(&swagger.Config{Endpoints: []swagger.EndpointConfig{{Method: "GET", Path: "/a"}}}, nil)
	defer r.Close()
	_, err := r.initRun(context.Background())
	require.NoError(t, err)
	r.oobStore.RegisterUUID("tok", &oob.OOBContext{Endpoint: "GET /a"})
	sub := r.Subscribe()
	r.finaliseRun()
	types, _ := runEvents(t, sub)
	assert.NotContains(t, types, EventOOBPending)
}

// The worst-case batch, every byte escaped by JSON, stays under the coordinator's 128 KB message
// limit, with room for the event envelope.
func TestOOBPendingBatch_FitsTheCoordinatorMessageLimit(t *testing.T) {
	tokens := make([]oob.PendingToken, oobPendingBatchSize)
	for i := range tokens {
		tokens[i] = oob.PendingToken{
			UUID:     "00000000-0000-4000-8000-000000000000",
			Endpoint: strings.Repeat("<", oob.MaxPendingFieldBytes),
			Payload:  strings.Repeat("<", oob.MaxPendingFieldBytes),
		}
	}
	b, err := json.Marshal(Event{Type: EventOOBPending, Data: OOBPendingBatch{Tokens: tokens}})
	require.NoError(t, err)
	assert.Less(t, len(b), 112*1024)
}

// The announcement is an empty batch, and only a run that hands over sends it.
func TestAnnounceOOBHandOver(t *testing.T) {
	r := New(&swagger.Config{}, nil)
	defer r.Close()
	sub := r.Subscribe()
	r.announceOOBHandOver()
	r.HandOverOOBTokens()
	r.announceOOBHandOver()
	types, _ := runEvents(t, sub)
	assert.Equal(t, []string{EventOOBPending}, types)
}
