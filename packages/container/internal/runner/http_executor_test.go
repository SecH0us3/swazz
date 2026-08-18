// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
)

func TestAdaptiveRateLimitAndUA(t *testing.T) {
	var mu sync.Mutex
	attempts := 0
	var userAgents []string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		userAgents = append(userAgents, r.Header.Get("User-Agent"))
		if attempts == 0 {
			attempts++
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		attempts++
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	cfg := &swagger.Config{
		BaseURL: server.URL,
		Settings: swagger.Settings{
			EnableAdaptiveRateLimit: true,
			RandomizeUserAgent:      true,
			TimeoutMs:               5000,
		},
	}
	// We need a minimal runner
	runner := &Runner{
		client: server.Client(),
		config: cfg,
	}

	start := time.Now()
	res := runner.executeRequest(context.Background(), server.URL, "/", "/", "GET", nil, nil, nil, swagger.ProfileRandom, nil, nil, "")
	duration := time.Since(start)

	mu.Lock()
	attemptsVal := attempts
	userAgentsVal := make([]string, len(userAgents))
	copy(userAgentsVal, userAgents)
	mu.Unlock()

	assert.Equal(t, 200, res.Status)
	assert.Equal(t, 2, attemptsVal)
	assert.GreaterOrEqual(t, duration.Seconds(), 1.0, "Should have backed off for at least 1 second based on Retry-After")

	// Ensure UA was randomized, not the default
	assert.NotEmpty(t, userAgentsVal)
	for _, ua := range userAgentsVal {
		assert.NotEqual(t, "Swazz/1.0 (+https://github.com/SecH0us3/swazz)", ua)
	}
}

func TestExecuteGRPCRequest_Basic(t *testing.T) {
	r := &Runner{
		config: &swagger.Config{
			BaseURL: "127.0.0.1:50051",
			Settings: swagger.Settings{
				TimeoutMs: 1000,
			},
		},
	}
	defer r.Close()
	res := r.executeGRPCRequest(context.Background(), "127.0.0.1:50051", "/demo.UserService/GetUser", "/demo.UserService/GetUser", map[string]any{"id": 1}, swagger.ProfileRandom, nil)
	assert.NotNil(t, res)
	assert.Equal(t, "GRPC", res.Method)
	assert.Equal(t, "/demo.UserService/GetUser", res.Endpoint)
}
