package ratelimit

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"swazz-engine/internal/classifier"
)

func TestCheck_NoRateLimit(t *testing.T) {
	// A server that always returns 200 OK
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()

	ctx := context.Background()
	finding, statusCodes := Check(
		ctx,
		server.Client(),
		server.URL,
		"/api/test",
		"/api/test",
		"GET",
		nil,
		nil,
		nil,
		"",
		10,
		1000,
	)

	if finding == nil {
		t.Fatal("expected finding for no rate limit, got nil")
	}
	if finding.RuleID != "swazz/no-rate-limit" {
		t.Errorf("expected RuleID swazz/no-rate-limit, got %s", finding.RuleID)
	}
	if finding.Level != classifier.SeverityWarning {
		t.Errorf("expected warning severity, got %v", finding.Level)
	}
	var sent, count429 int
	for _, code := range statusCodes {
		if code != 0 {
			sent++
		}
		if code == http.StatusTooManyRequests {
			count429++
		}
	}
	if sent != 10 {
		t.Errorf("expected 10 sent requests, got %d", sent)
	}
	if count429 != 0 {
		t.Errorf("expected 0 429s, got %d", count429)
	}
}

func TestCheck_RateLimitActive(t *testing.T) {
	var requestCount int32
	// A server that returns 429 after 5 requests
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count := atomic.AddInt32(&requestCount, 1)
		if count > 5 {
			w.Header().Set("Retry-After", "10")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	ctx := context.Background()
	finding, statusCodes := Check(
		ctx,
		server.Client(),
		server.URL,
		"/api/test",
		"/api/test",
		"GET",
		nil,
		nil,
		nil,
		"",
		10,
		1000,
	)

	if finding == nil {
		t.Fatal("expected finding for rate limit active, got nil")
	}
	if finding.RuleID != "swazz/rate-limit-active" {
		t.Errorf("expected RuleID swazz/rate-limit-active, got %s", finding.RuleID)
	}
	if finding.Level != classifier.SeverityNote {
		t.Errorf("expected Note severity, got %v", finding.Level)
	}
	var sent, count429 int
	for _, code := range statusCodes {
		if code != 0 {
			sent++
		}
		if code == http.StatusTooManyRequests {
			count429++
		}
	}
	if sent != 10 {
		t.Errorf("expected 10 sent requests, got %d", sent)
	}
	if count429 != 5 {
		t.Errorf("expected 5 429s, got %d", count429)
	}
}

func TestCheck_ContextCancelled(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	// Cancel immediately
	cancel()

	finding, statusCodes := Check(
		ctx,
		server.Client(),
		server.URL,
		"/api/test",
		"/api/test",
		"GET",
		nil,
		nil,
		nil,
		"",
		10,
		1000,
	)

	var sent, count429 int
	for _, code := range statusCodes {
		if code != 0 {
			sent++
		}
		if code == http.StatusTooManyRequests {
			count429++
		}
	}
	// Since context was cancelled, no requests should be sent.
	if sent != 0 {
		t.Errorf("expected 0 sent requests under cancelled context, got %d", sent)
	}
	if count429 != 0 {
		t.Errorf("expected 0 429s, got %d", count429)
	}
	if finding != nil {
		t.Errorf("expected nil finding because no requests could be sent, got %v", finding)
	}
}
