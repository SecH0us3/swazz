// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/license"
	"swazz-engine/internal/swagger"
)

func TestConcurrencyLimiter_Basic(t *testing.T) {
	l := NewConcurrencyLimiter(2)
	assert.Equal(t, 2, l.GetTarget())

	ctx := context.Background()
	err := l.Acquire(ctx)
	assert.NoError(t, err)

	err = l.Acquire(ctx)
	assert.NoError(t, err)

	// Third acquire should block, let's test with a timeout context
	timeoutCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	err = l.Acquire(timeoutCtx)
	assert.ErrorIs(t, err, context.DeadlineExceeded)

	// Release one
	l.Release()

	// Now we should be able to acquire
	acquireCtx, cancel2 := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel2()
	err = l.Acquire(acquireCtx)
	assert.NoError(t, err)
}

func TestConcurrencyLimiter_SetTarget(t *testing.T) {
	l := NewConcurrencyLimiter(1)

	ctx := context.Background()
	err := l.Acquire(ctx)
	assert.NoError(t, err)

	// Increase target
	l.SetTarget(2)
	assert.Equal(t, 2, l.GetTarget())

	// Should be able to acquire again
	err = l.Acquire(ctx)
	assert.NoError(t, err)
}

func TestConcurrencyLimiter_Concurrent(t *testing.T) {
	l := NewConcurrencyLimiter(5)
	ctx := context.Background()
	var wg sync.WaitGroup

	var activeCount int64
	var maxActive int64

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := l.Acquire(ctx)
			if err != nil {
				return
			}
			active := atomic.AddInt64(&activeCount, 1)
			for {
				currentMax := atomic.LoadInt64(&maxActive)
				if active > currentMax {
					if atomic.CompareAndSwapInt64(&maxActive, currentMax, active) {
						break
					}
				} else {
					break
				}
			}
			time.Sleep(10 * time.Millisecond)
			atomic.AddInt64(&activeCount, -1)
			l.Release()
		}()
	}

	wg.Wait()
	assert.True(t, maxActive <= 5, "Max active goroutines (%d) exceeded limit (5)", maxActive)
}

func TestConcurrencyLimiter_Ceiling(t *testing.T) {
	t.Run("constructor clamps initial target to ceiling", func(t *testing.T) {
		l := NewConcurrencyLimiter(50, 5)
		assert.Equal(t, 5, l.GetTarget())
		assert.Equal(t, 5, l.GetCeiling())
	})

	t.Run("SetTarget clamps to ceiling", func(t *testing.T) {
		l := NewConcurrencyLimiter(2, 5)
		l.SetTarget(100)
		assert.Equal(t, 5, l.GetTarget())
	})

	t.Run("SetCeiling re-clamps current target", func(t *testing.T) {
		l := NewConcurrencyLimiter(10, 20)
		assert.Equal(t, 10, l.GetTarget())
		l.SetCeiling(8)
		assert.Equal(t, 8, l.GetTarget())
	})

	t.Run("no ceiling defaults to absolute max", func(t *testing.T) {
		l := NewConcurrencyLimiter(10)
		assert.Equal(t, license.MaxConcurrencyCeiling, l.GetCeiling())
		l.SetTarget(500)
		assert.Equal(t, 500, l.GetTarget())
	})

	t.Run("community gate caps at free ceiling", func(t *testing.T) {
		l := NewConcurrencyLimiter(50, license.NewCommunityGate().ConcurrencyCeiling())
		assert.Equal(t, license.FreeConcurrencyCeiling, l.GetTarget())
	})

	t.Run("license gate caps at MaxConcurrency", func(t *testing.T) {
		lic := &license.License{
			Company:        "Scaled",
			ExpiresAt:      time.Now().Add(24 * time.Hour),
			Features:       []string{license.FeatureHighConcurrency},
			MaxConcurrency: 50,
		}
		gate := license.NewLicenseGate(lic)
		l := NewConcurrencyLimiter(100, gate.ConcurrencyCeiling())
		assert.Equal(t, 50, l.GetTarget())
	})

	t.Run("all-features gate does not clamp", func(t *testing.T) {
		gate := license.NewAllFeaturesGate()
		l := NewConcurrencyLimiter(100, gate.ConcurrencyCeiling())
		assert.Equal(t, 100, l.GetTarget())
	})
}

func TestRunnerGate(t *testing.T) {
	t.Run("defaults to community gate", func(t *testing.T) {
		cfg := &swagger.Config{Settings: swagger.Settings{Concurrency: 5}}
		r := New(cfg, nil)
		require.NotNil(t, r)
		defer r.Close()
		assert.False(t, r.Gate().Has(license.FeatureReportExports))
		assert.Equal(t, license.FreeConcurrencyCeiling, r.Gate().ConcurrencyCeiling())
	})

	t.Run("accepts injected gate", func(t *testing.T) {
		cfg := &swagger.Config{Settings: swagger.Settings{Concurrency: 5}}
		r := New(cfg, nil, license.NewAllFeaturesGate())
		require.NotNil(t, r)
		defer r.Close()
		assert.True(t, r.Gate().Has(license.FeatureReportExports))
		assert.Equal(t, license.MaxConcurrencyCeiling, r.Gate().ConcurrencyCeiling())
	})
}
