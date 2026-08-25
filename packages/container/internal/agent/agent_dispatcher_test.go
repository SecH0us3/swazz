package agent

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewAgentDispatcher(t *testing.T) {
	outChan := make(chan interface{}, 5)
	d := NewAgentDispatcher("ws://localhost/connect", "token123", false, outChan)
	require.NotNil(t, d)
	assert.Equal(t, "ws://localhost/connect", d.coordinatorURL)
	assert.Equal(t, "token123", d.token)
	assert.False(t, d.disableTelemetry)
	assert.NotNil(t, d.activeRunners)
	assert.NotNil(t, d.parseReqSem)
}

func TestAgentDispatcher_SendWSMethods(t *testing.T) {
	outChan := make(chan interface{}, 5)
	d := NewAgentDispatcher("ws://localhost", "tok", false, outChan)

	d.SendWSEvent("run-1", "test_event", map[string]string{"foo": "bar"})

	select {
	case msg := <-outChan:
		outMsg, ok := msg.(WSEventOut)
		require.True(t, ok)
		assert.Equal(t, "event", outMsg.Type)
		assert.Equal(t, "run-1", outMsg.RunID)
		
		payload, ok := outMsg.Payload.(WSEventPayload)
		require.True(t, ok)
		assert.Equal(t, "test_event", payload.Type)
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for SendWSEvent message on outChan")
	}

	d.SendWSError("run-2", "something went wrong")

	select {
	case msg := <-outChan:
		outMsg, ok := msg.(WSEventOut)
		require.True(t, ok)
		assert.Equal(t, "error", outMsg.Type)
		assert.Equal(t, "run-2", outMsg.RunID)
		
		payloadMap, ok := outMsg.Payload.(map[string]string)
		require.True(t, ok)
		assert.Equal(t, "something went wrong", payloadMap["error"])
	case <-time.After(1 * time.Second):
		t.Fatal("Timeout waiting for SendWSError message on outChan")
	}
}

func TestAgentDispatcher_Dispatch_JobCommand_UnknownRunner(t *testing.T) {
	outChan := make(chan interface{}, 5)
	d := NewAgentDispatcher("ws://localhost", "tok", false, outChan)

	cmdPayload := JobCommandPayload{
		Command: "stop",
		RunID:   "unknown-run",
	}
	payloadBytes, _ := json.Marshal(cmdPayload)

	msgIn := WSMessageIn{
		Type:    "job_command",
		Payload: payloadBytes,
	}

	assert.NotPanics(t, func() {
		d.Dispatch(context.Background(), msgIn)
	})
}

func TestAgentDispatcher_Dispatch_ParseRequest_InvalidJSON(t *testing.T) {
	outChan := make(chan interface{}, 5)
	d := NewAgentDispatcher("ws://localhost", "tok", false, outChan)

	msgIn := WSMessageIn{
		Type:    "parse_request",
		ReqID:   "req-123",
		Payload: []byte(`{invalid_json: true`),
	}

	assert.NotPanics(t, func() {
		d.Dispatch(context.Background(), msgIn)
	})
}

func TestAgentDispatcher_StopAllRunners_Empty(t *testing.T) {
	outChan := make(chan interface{}, 5)
	d := NewAgentDispatcher("ws://localhost", "tok", false, outChan)

	assert.NotPanics(t, func() {
		d.StopAllRunners()
	})
}

func TestAgentDispatcher_Dispatch_OOBTrigger_UnknownRunner(t *testing.T) {
	outChan := make(chan interface{}, 5)
	d := NewAgentDispatcher("ws://localhost", "tok", false, outChan)

	payloadBytes := []byte(`{"runId": "run-oob", "uuid": "uuid-123"}`)
	msgIn := WSMessageIn{
		Type:    "oob_trigger",
		Payload: payloadBytes,
	}

	assert.NotPanics(t, func() {
		d.Dispatch(context.Background(), msgIn)
	})
	
	// Test with missing fields (should error internally but not panic)
	msgIn.Payload = []byte(`{"runId": ""}`)
	assert.NotPanics(t, func() {
		d.Dispatch(context.Background(), msgIn)
	})
	
	// Test with invalid JSON
	msgIn.Payload = []byte(`{bad_json}`)
	assert.NotPanics(t, func() {
		d.Dispatch(context.Background(), msgIn)
	})
}
