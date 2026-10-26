// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package boundedmap

import "testing"

func TestMap_DropsLeastRecentlySetFirst(t *testing.T) {
	m := New[string, int](2)
	m.Set("a", 1)
	m.Set("b", 2)
	m.Set("a", 3) // a is now the most recent
	if dropped := m.Set("c", 4); !dropped {
		t.Fatal("setting past the limit dropped nothing")
	}
	if _, ok := m.Get("b"); ok {
		t.Error("b, the least recent, survived")
	}
	if v, ok := m.Get("a"); !ok || v != 3 {
		t.Errorf("a = %v, %v", v, ok)
	}
	if m.Len() != 2 {
		t.Errorf("len = %d", m.Len())
	}
}

func TestMap_DeleteAndReSet(t *testing.T) {
	m := New[string, int](2)
	m.Set("x", 1)
	m.Set("y", 2)
	if v, ok := m.Delete("x"); !ok || v != 1 {
		t.Fatalf("delete = %v, %v", v, ok)
	}
	m.Set("x", 5) // set again after a delete: one entry, the most recent
	m.Set("z", 6)
	if _, ok := m.Get("y"); ok {
		t.Error("y should have been dropped first")
	}
	if v, ok := m.Get("x"); !ok || v != 5 {
		t.Errorf("x = %v, %v", v, ok)
	}
	if _, ok := m.Delete("missing"); ok {
		t.Error("deleted a missing key")
	}
}

func TestMap_ClearAndLimitFloor(t *testing.T) {
	m := New[int, int](0)
	m.Set(1, 1)
	m.Set(2, 2)
	if m.Len() != 1 {
		t.Fatalf("a limit below 1 is 1: len = %d", m.Len())
	}
	m.Clear()
	if m.Len() != 0 {
		t.Fatal("clear left entries")
	}
	if _, ok := m.Get(2); ok {
		t.Fatal("clear left an entry readable")
	}
}
