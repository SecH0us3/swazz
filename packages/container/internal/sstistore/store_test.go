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
