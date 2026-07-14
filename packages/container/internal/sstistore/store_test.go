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
