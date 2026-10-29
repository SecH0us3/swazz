// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package oob

import (
	"strings"
	"testing"
	"unicode/utf8"

	"swazz-engine/internal/swagger"
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

// TakePending takes the waiting tokens out, newest first, with long fields cut on a character
// boundary.
func TestStore_TakePending(t *testing.T) {
	s := NewStoreWithLimit(10)
	if got := s.TakePending(5); len(got) != 0 {
		t.Fatalf("empty store gave %v", got)
	}
	s.RegisterUUID("a", &OOBContext{Endpoint: "GET /a", Payload: "p"})
	s.RegisterUUID("b", &OOBContext{Endpoint: "GET /" + strings.Repeat("é", MaxPendingFieldBytes), Payload: map[string]any{"k": 1}})
	s.RegisterUUID("c", &OOBContext{Endpoint: "GET /c", Payload: "c"})
	s.GetAndRemoveUUID("c") // answered: not pending
	got := s.TakePending(1)
	if len(got) != 1 || got[0].UUID != "b" {
		t.Fatalf("TakePending(1) = %+v, want b", got)
	}
	if _, ok := s.GetAndRemoveUUID("b"); ok {
		t.Error("a taken token is still matched")
	}
	s.RegisterUUID("b", &OOBContext{Endpoint: "GET /" + strings.Repeat("é", MaxPendingFieldBytes), Payload: map[string]any{"k": 1}})
	got = s.TakePending(5)
	if len(got) != 2 || got[0].UUID != "b" || got[1].UUID != "a" {
		t.Fatalf("Pending = %+v, want b then a", got)
	}
	if len(got[0].Endpoint) > MaxPendingFieldBytes || !utf8.ValidString(got[0].Endpoint) {
		t.Errorf("endpoint of %d bytes not cut cleanly", len(got[0].Endpoint))
	}
	if got[0].Payload != "map[k:1]" {
		t.Errorf("payload = %q", got[0].Payload)
	}
	if s.Size() != 0 {
		t.Errorf("%d tokens left after taking all", s.Size())
	}
	var nilStore *Store
	if nilStore.TakePending(3) != nil {
		t.Error("nil store has pending tokens")
	}
}

// A cut keeps everything before the limit, even after an invalid byte.
func TestCutUTF8(t *testing.T) {
	s := "ab\xffcd" + strings.Repeat("é", 10)
	if got := cutUTF8(s, 9); len(got) != 9 && len(got) != 8 {
		t.Fatalf("cut to %d bytes: %q", len(got), got)
	}
	if got := cutUTF8("ééé", 3); got != "é" {
		t.Fatalf("cutUTF8 split a character: %q", got)
	}
	if got := cutUTF8(strings.Repeat("\x80", 300), 256); len(got) < 256-utf8.UTFMax {
		t.Fatalf("continuation bytes cut to %d bytes", len(got))
	}
	if got := cutUTF8("abc", 10); got != "abc" {
		t.Fatalf("short string changed: %q", got)
	}
}

// A large non-string payload is formatted only as far as it is kept.
func TestPayloadText_Bounded(t *testing.T) {
	big := make([]string, 10_000)
	for i := range big {
		big[i] = "xxxxxxxx"
	}
	if got := payloadText(big); len(got) > MaxPendingFieldBytes+utf8.UTFMax {
		t.Fatalf("formatted %d bytes", len(got))
	}
	if got := payloadText("plain"); got != "plain" {
		t.Fatalf("string payload = %q", got)
	}
}

func TestStore_ConcurrentRegisterAndSize(t *testing.T) {
	s := NewStoreWithLimit(100)
	done := make(chan struct{})

	go func() {
		for i := 0; i < 500; i++ {
			s.RegisterUUID(strings.Repeat("u", 10), &OOBContext{})
			_ = s.Size()
		}
		close(done)
	}()

	for {
		select {
		case <-done:
			return
		default:
			_ = s.Size()
		}
	}
}
