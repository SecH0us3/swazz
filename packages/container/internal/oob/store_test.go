package oob

import (
	"swazz-engine/internal/swagger"
	"testing"
)

func TestOOBStore(t *testing.T) {
	store := NewStore()
	uuidStr := "test-uuid-1234"
	ctx := &OOBContext{
		Endpoint: "test-endpoint",
		Payload:  "test-payload",
	}

	store.RegisterUUID(uuidStr, ctx)

	retrieved, ok := store.GetAndRemoveUUID(uuidStr)
	if !ok {
		t.Fatalf("Expected to find registered UUID")
	}
	if retrieved.Endpoint != "test-endpoint" {
		t.Errorf("Expected endpoint %q, got %q", "test-endpoint", retrieved.Endpoint)
	}

	_, okAgain := store.GetAndRemoveUUID(uuidStr)
	if okAgain {
		t.Errorf("Expected UUID to be removed after first retrieval")
	}

	// Test UpdateRequest
	importSwagger := &swagger.RequestLog{Method: "POST"}
	store.RegisterUUID("test-uuid-2", ctx)
	store.UpdateRequest("test-uuid-2", importSwagger)
	
	retrieved2, ok2 := store.GetAndRemoveUUID("test-uuid-2")
	if !ok2 || retrieved2.Request != importSwagger {
		t.Errorf("Expected request log to be updated on retrieved context")
	}

	// UpdateRequest for non-existent UUID should not panic
	store.UpdateRequest("non-existent", importSwagger)

	// Test Clear
	store.RegisterUUID("test-uuid-3", ctx)
	store.Clear()
	_, ok3 := store.GetAndRemoveUUID("test-uuid-3")
	if ok3 {
		t.Error("Expected store to be empty after Clear")
	}

	// Test GlobalStore singleton
	if GlobalStore == nil {
		t.Error("Expected GlobalStore not to be nil")
	}
}

