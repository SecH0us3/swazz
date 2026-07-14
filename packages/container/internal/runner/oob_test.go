package runner

import (
	"testing"
	"time"

	"swazz-engine/internal/oob"
	"swazz-engine/internal/swagger"
	"github.com/stretchr/testify/assert"
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
	oob.GlobalStore.RegisterUUID(uuid, ctx)

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
		assert.Equal(t, "POST /api/user", res.Endpoint)
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
