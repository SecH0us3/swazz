package runner

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
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
