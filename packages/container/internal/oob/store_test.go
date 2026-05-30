package oob

import (
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
}
