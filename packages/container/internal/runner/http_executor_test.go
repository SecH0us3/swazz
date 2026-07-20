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
