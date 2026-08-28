// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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

	// Test Size
	store.RegisterUUID("test-uuid-4", ctx)
	store.RegisterUUID("test-uuid-5", ctx)
	if size := store.Size(); size != 2 {
		t.Errorf("Expected Size to be 2, got %d", size)
	}

	// Test ClearSession
	ctxSession1 := &OOBContext{SessionID: "sess-1", Endpoint: "ep-1"}
	ctxSession2 := &OOBContext{SessionID: "sess-2", Endpoint: "ep-2"}

	store.RegisterUUID("uuid-s1-a", ctxSession1)
	store.RegisterUUID("uuid-s1-b", ctxSession1)
	store.RegisterUUID("uuid-s2-a", ctxSession2)

	if size := store.Size(); size != 5 {
		t.Errorf("Expected Size to be 5, got %d", size)
	}

	store.ClearSession("sess-1")

	if size := store.Size(); size != 3 {
		t.Errorf("Expected Size to be 3 after clearing sess-1, got %d", size)
	}

	_, okS1 := store.GetAndRemoveUUID("uuid-s1-a")
	if okS1 {
		t.Errorf("Expected uuid-s1-a to be removed by ClearSession")
	}

	_, okS2 := store.GetAndRemoveUUID("uuid-s2-a")
	if !okS2 {
		t.Errorf("Expected uuid-s2-a to remain after clearing sess-1")
	}
}
