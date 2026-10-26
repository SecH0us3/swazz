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

	// Test Size
	store.RegisterUUID("test-uuid-4", ctx)
	store.RegisterUUID("test-uuid-5", ctx)
	if size := store.Size(); size != 2 {
		t.Errorf("Expected Size to be 2, got %d", size)
	}
}

// A nil store holds nothing and never panics: a generator or runner without one sends its payloads
// unregistered.
func TestOOBStore_Nil(t *testing.T) {
	var store *Store
	store.RegisterUUID("u", &OOBContext{})
	store.UpdateRequest("u", &swagger.RequestLog{})
	store.Clear()
	if _, ok := store.GetAndRemoveUUID("u"); ok {
		t.Error("nil store returned a context")
	}
	if store.Size() != 0 {
		t.Error("nil store has a size")
	}
}

// A full store drops its oldest tokens first, so a long scan stays bounded.
func TestStore_EvictsOldestPastTheLimit(t *testing.T) {
	s := NewStoreWithLimit(3)
	for _, id := range []string{"a", "b", "c", "d"} {
		s.RegisterUUID(id, &OOBContext{SessionID: id})
	}
	if s.Size() != 3 {
		t.Fatalf("size = %d, want 3", s.Size())
	}
	if _, ok := s.GetAndRemoveUUID("a"); ok {
		t.Error("the oldest token survived")
	}
	for _, id := range []string{"b", "c", "d"} {
		if _, ok := s.GetAndRemoveUUID(id); !ok {
			t.Errorf("token %s was dropped", id)
		}
	}
}

// A removed token frees its slot, and registering it again does not evict anything.
func TestStore_RemoveFreesSlot(t *testing.T) {
	s := NewStoreWithLimit(2)
	s.RegisterUUID("a", &OOBContext{})
	s.RegisterUUID("b", &OOBContext{})
	s.GetAndRemoveUUID("a")
	s.RegisterUUID("a", &OOBContext{})
	if s.Size() != 2 {
		t.Fatalf("size = %d, want 2", s.Size())
	}
	if _, ok := s.GetAndRemoveUUID("b"); !ok {
		t.Error("b was evicted although a slot was free")
	}
}

// Registering a token again keeps one entry with the newest context.
func TestStore_ReRegisterKeepsOneEntry(t *testing.T) {
	s := NewStoreWithLimit(2)
	s.RegisterUUID("a", &OOBContext{SessionID: "1"})
	s.RegisterUUID("a", &OOBContext{SessionID: "2"})
	s.RegisterUUID("b", &OOBContext{})
	if s.Size() != 2 {
		t.Fatalf("size = %d, want 2", s.Size())
	}
	ctx, ok := s.GetAndRemoveUUID("a")
	if !ok || ctx.SessionID != "2" {
		t.Fatalf("got %+v, %v", ctx, ok)
	}
}

// The drop handler runs once per run, without the store locked, and again after Clear.
func TestStore_OnFirstDropOncePerClear(t *testing.T) {
	s := NewStoreWithLimit(1)
	calls := 0
	s.OnFirstDrop(func() {
		calls++
		_ = s.Size() // would deadlock if the store were still locked
	})
	s.RegisterUUID("a", &OOBContext{})
	if calls != 0 {
		t.Fatal("handler ran without a drop")
	}
	s.RegisterUUID("b", &OOBContext{})
	s.RegisterUUID("c", &OOBContext{})
	if calls != 1 {
		t.Fatalf("handler ran %d times, want 1", calls)
	}
	s.Clear()
	s.RegisterUUID("d", &OOBContext{})
	s.RegisterUUID("e", &OOBContext{})
	if calls != 2 {
		t.Fatalf("handler ran %d times after Clear, want 2", calls)
	}
}
