// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package mcp

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRateLimiter(t *testing.T) {
	rl := NewRateLimiter(50, 2)
	assert.NotNil(t, rl)

	ctx := context.Background()

	// 1. Allow normal request
	assert.True(t, rl.Allow(ctx))

	// 2. AllowN requests
	assert.True(t, rl.AllowN(ctx, 3))

	// 3. SetRate
	rl.SetRate(1)

	// 4. Max waiters rejection
	rl.mu.Lock()
	rl.waiting = 2 // equals maxWait (2)
	rl.mu.Unlock()
	assert.False(t, rl.Allow(ctx))
	assert.False(t, rl.AllowN(ctx, 2))

	// Reset waiting
	rl.mu.Lock()
	rl.waiting = 0
	rl.mu.Unlock()

	// 5. Cancelled context
	cancelCtx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately
	// Drain burst
	for i := 0; i < 15; i++ {
		_ = rl.Allow(context.Background())
	}
	assert.False(t, rl.Allow(cancelCtx))
}
