// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package sstistore

import "testing"

func TestStoreRegisterAndGet(t *testing.T) {
	s := NewStore()
	payload := "{{23*37}}"
	ctx := SSTIContext{RawExpr: "23*37", Expected: "851"}

	s.Register(payload, ctx)

	got, found := s.Get(payload)
	if !found {
		t.Fatal("expected payload to be found in store")
	}
	if got.RawExpr != "23*37" || got.Expected != "851" {
		t.Errorf("unexpected context got: %+v", got)
	}

	s.Clear()
	_, found = s.Get(payload)
	if found {
		t.Error("expected payload to be cleared from store")
	}
}

// A nil store holds nothing and never panics: an analyzer without one matches no randomized payload.
func TestStore_Nil(t *testing.T) {
	var s *Store
	s.Register("{{23*37}}", SSTIContext{RawExpr: "23*37", Expected: "851"})
	s.Clear()
	if _, found := s.Get("{{23*37}}"); found {
		t.Error("nil store returned a context")
	}
}

// A full store drops its least recently registered expressions first, so a long scan stays
// bounded; registering an expression again keeps it.
func TestStore_EvictsLeastRecentPastTheLimit(t *testing.T) {
	s := NewStoreWithLimit(2)
	s.Register("a", SSTIContext{Expected: "1"})
	s.Register("b", SSTIContext{Expected: "2"})
	s.Register("a", SSTIContext{Expected: "3"}) // sent again: now the most recent
	s.Register("c", SSTIContext{Expected: "4"})
	if _, ok := s.Get("b"); ok {
		t.Error("the least recent expression survived")
	}
	if got, ok := s.Get("a"); !ok || got.Expected != "3" {
		t.Errorf("a = %+v, %v", got, ok)
	}
	if _, ok := s.Get("c"); !ok {
		t.Error("the newest expression was dropped")
	}
	s.Clear()
	if _, ok := s.Get("a"); ok {
		t.Error("Clear kept an expression")
	}
}

// The drop handler runs once per run, without the store locked, and again after Clear.
func TestStore_OnFirstDropOncePerClear(t *testing.T) {
	s := NewStoreWithLimit(1)
	calls := 0
	s.OnFirstDrop(func() {
		calls++
		_, _ = s.Get("x") // would deadlock if the store were still locked
	})
	s.Register("a", SSTIContext{})
	s.Register("a", SSTIContext{}) // an update drops nothing
	if calls != 0 {
		t.Fatal("handler ran without a drop")
	}
	s.Register("b", SSTIContext{})
	s.Register("c", SSTIContext{})
	if calls != 1 {
		t.Fatalf("handler ran %d times, want 1", calls)
	}
	s.Clear()
	s.Register("d", SSTIContext{})
	s.Register("e", SSTIContext{})
	if calls != 2 {
		t.Fatalf("handler ran %d times after Clear, want 2", calls)
	}
}
