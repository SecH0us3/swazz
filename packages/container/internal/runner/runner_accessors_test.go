// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"swazz-engine/internal/swagger"
)

func newAccessorRunner(t *testing.T) *Runner {
	t.Helper()
	r := New(&swagger.Config{BaseURL: "http://127.0.0.1:1"}, nil)
	t.Cleanup(r.Close)
	return r
}

func TestRunner_GettersInitialState(t *testing.T) {
	r := newAccessorRunner(t)
	if got := r.Results(); len(got) != 0 {
		t.Errorf("Results() on a fresh runner should be empty, got %d", len(got))
	}
	if r.GetWAFCheckResult() != nil {
		t.Error("GetWAFCheckResult() should be nil before any WAF check")
	}
}

func TestRunner_BroadcastDeliversToSubscribers(t *testing.T) {
	r := newAccessorRunner(t)
	ch := r.Subscribe()
	defer r.Unsubscribe(ch)

	res := &swagger.FuzzResult{ID: "x", Endpoint: "/e", Method: "GET", Status: 200}
	go r.BroadcastResult(res)

	select {
	case ev := <-ch:
		if ev.Type != EventResult {
			t.Errorf("expected EventResult, got %q", ev.Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("BroadcastResult event was not delivered")
	}

	go r.BroadcastProgress()
	select {
	case ev := <-ch:
		if ev.Type != EventProgress {
			t.Errorf("expected EventProgress, got %q", ev.Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("BroadcastProgress event was not delivered")
	}
}

func TestRunner_Limiter(t *testing.T) {
	r := newAccessorRunner(t)
	r.SetLimiterTarget(1)
	ctx := context.Background()
	if err := r.LimiterAcquire(ctx); err != nil {
		t.Fatalf("first acquire failed: %v", err)
	}
	r.LimiterRelease()
	// After release the single slot is free again.
	if err := r.LimiterAcquire(ctx); err != nil {
		t.Fatalf("acquire after release failed: %v", err)
	}
	r.LimiterRelease()
}


func TestRunner_ExecuteRequest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	r := New(&swagger.Config{BaseURL: srv.URL, Security: swagger.SecurityConfig{AllowPrivateIPs: true}}, srv.Client())
	t.Cleanup(r.Close)

	res := r.ExecuteRequest(context.Background(), srv.URL, "/t", "/t", "GET",
		nil, nil, nil, swagger.ProfileRandom, nil, nil, "")
	if res == nil {
		t.Fatal("ExecuteRequest returned nil")
	}
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if res.Status != http.StatusTeapot {
		t.Errorf("status: got %d, want %d", res.Status, http.StatusTeapot)
	}
}
