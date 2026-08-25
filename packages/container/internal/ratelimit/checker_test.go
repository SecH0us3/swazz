// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ratelimit

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
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

func TestCheck_PayloadsAndHeaders(t *testing.T) {
	var mu sync.Mutex
	var lastCT string
	var lastHost string
	var lastBody string
	var lastQuery string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		lastCT = r.Header.Get("Content-Type")
		lastHost = r.Host
		lastBody = string(body)
		lastQuery = r.URL.RawQuery
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	ctx := context.Background()

	// 1. Form urlencoded payload with queryParams and custom Host header
	Check(
		ctx,
		server.Client(),
		server.URL,
		"/form",
		"/form",
		"POST",
		map[string]string{"Host": "custom.domain.com", "User-Agent": "CustomUA"},
		map[string]any{"username": "admin", "age": 30},
		map[string]any{"ref": "xyz", "debug": 1},
		"application/x-www-form-urlencoded",
		1,
		-1, // test default timeout
	)
	assert.Contains(t, lastCT, "x-www-form-urlencoded")
	assert.Equal(t, "custom.domain.com", lastHost)
	assert.Contains(t, lastBody, "username=admin")
	assert.Contains(t, lastQuery, "ref=xyz")

	// 2. XML / SOAP payload
	Check(
		ctx,
		server.Client(),
		server.URL,
		"/soap",
		"/soap",
		"POST",
		nil,
		map[string]any{"itemId": "12345"},
		nil,
		"application/xml",
		-5, // test default burstSize
		2000,
	)
	assert.Contains(t, lastBody, "soap")

	// 3. Default JSON payload
	Check(
		ctx,
		server.Client(),
		server.URL,
		"/json",
		"/json",
		"POST",
		nil,
		map[string]any{"key": "value"},
		nil,
		"",
		1500, // test clamping burstSize > 1000
		2000,
	)
	assert.Equal(t, "application/json", lastCT)
	assert.Contains(t, lastBody, `"key":"value"`)
}
