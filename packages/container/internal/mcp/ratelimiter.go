package mcp

import (
	"context"
	"golang.org/x/time/rate"
	"sync"
)

// RateLimiter provides rate limiting for MCP tool calls to prevent DoS
type RateLimiter struct {
	limiter  *rate.Limiter
	mu       sync.Mutex
	waiting  int
	maxWait  int
}

// NewRateLimiter creates a new rate limiter with the specified requests per second and max concurrent waiters
func NewRateLimiter(requestsPerSecond float64, maxWaiters int) *RateLimiter {
	return &RateLimiter{
		limiter: rate.NewLimiter(rate.Limit(requestsPerSecond), 10), // burst of 10
		maxWait: maxWaiters,
	}
}

// Allow waits for a token and returns true if the request can proceed
func (rl *RateLimiter) Allow(ctx context.Context) bool {
	rl.mu.Lock()
	if rl.waiting >= rl.maxWait {
		rl.mu.Unlock()
		return false
	}
	rl.waiting++
	rl.mu.Unlock()

	if !rl.limiter.Allow() {
		// Wait for token with context
		if err := rl.limiter.Wait(ctx); err != nil {
			rl.mu.Lock()
			rl.waiting--
			rl.mu.Unlock()
			return false
		}
	}

	rl.mu.Lock()
	rl.waiting--
	rl.mu.Unlock()
	return true
}

// AllowN allows n tokens
func (rl *RateLimiter) AllowN(ctx context.Context, n int) bool {
	for i := 0; i < n; i++ {
		if !rl.Allow(ctx) {
			return false
		}
	}
	return true
}

// SetRate updates the rate limit
func (rl *RateLimiter) SetRate(requestsPerSecond float64) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.limiter = rate.NewLimiter(rate.Limit(requestsPerSecond), 10)
}

// DefaultRateLimiter is a package-level rate limiter for MCP calls
// Default: 100 requests per second with max 100 concurrent waiters
var DefaultRateLimiter = NewRateLimiter(100, 100)
