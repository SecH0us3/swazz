// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"sync"

	"swazz-engine/internal/license"
)

type ConcurrencyLimiter struct {
	mu      sync.Mutex
	target  int
	ceiling int
	current int
	waiters []chan struct{}
}

// NewConcurrencyLimiter creates a limiter with the given initial target.
// An optional ceiling caps the target (defaults to MaxConcurrencyCeiling).
func NewConcurrencyLimiter(initial int, ceilings ...int) *ConcurrencyLimiter {
	if initial <= 0 {
		initial = 5
	}
	if initial > 1000 {
		initial = 1000
	}
	ceiling := license.MaxConcurrencyCeiling
	if len(ceilings) > 0 && ceilings[0] > 0 {
		ceiling = ceilings[0]
	}
	if initial > ceiling {
		initial = ceiling
	}
	return &ConcurrencyLimiter{
		target:  initial,
		ceiling: ceiling,
	}
}

// SetCeiling updates the maximum allowed target. The current target is
// re-clamped immediately.
func (l *ConcurrencyLimiter) SetCeiling(ceiling int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if ceiling <= 0 {
		ceiling = license.MaxConcurrencyCeiling
	}
	l.ceiling = ceiling
	if l.target > l.ceiling {
		l.target = l.ceiling
	}
}

func (l *ConcurrencyLimiter) GetCeiling() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.ceiling
}

func (l *ConcurrencyLimiter) SetTarget(target int) {
	l.mu.Lock()
	if target <= 0 {
		target = 1
	}
	if target > 1000 {
		target = 1000
	}
	if target > l.ceiling {
		target = l.ceiling
	}
	l.target = target

	// Wake up as many waiters as the new target allows
	for len(l.waiters) > 0 && l.current < l.target {
		l.current++
		ch := l.waiters[0]
		l.waiters = l.waiters[1:]
		close(ch)
	}
	l.mu.Unlock()
}

func (l *ConcurrencyLimiter) GetTarget() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.target
}

func (l *ConcurrencyLimiter) Acquire(ctx context.Context) error {
	l.mu.Lock()
	if l.current < l.target {
		l.current++
		l.mu.Unlock()
		return nil
	}
	ch := make(chan struct{})
	l.waiters = append(l.waiters, ch)
	l.mu.Unlock()

	select {
	case <-ch:
		return nil
	case <-ctx.Done():
		l.mu.Lock()
		found := false
		for i, w := range l.waiters {
			if w == ch {
				l.waiters = append(l.waiters[:i], l.waiters[i+1:]...)
				found = true
				break
			}
		}
		if !found {
			// Already popped and handed a slot, but we timed out/cancelled.
			// Return the slot and pass it to the next waiter if any.
			l.current--
			if len(l.waiters) > 0 && l.current < l.target {
				l.current++
				nextCh := l.waiters[0]
				l.waiters = l.waiters[1:]
				close(nextCh)
			}
		}
		l.mu.Unlock()
		return ctx.Err()
	}
}

func (l *ConcurrencyLimiter) Release() {
	l.mu.Lock()
	l.current--
	if len(l.waiters) > 0 && l.current < l.target {
		l.current++
		ch := l.waiters[0]
		l.waiters = l.waiters[1:]
		close(ch)
	}
	l.mu.Unlock()
}

func (r *Runner) GetConcurrency() int {
	return r.limiter.GetTarget()
}

// Gate returns the license gate used by this runner.
func (r *Runner) Gate() license.Gate {
	return r.gate
}

func (r *Runner) SetConcurrency(c int) {
	r.configMu.Lock()
	r.config.Settings.Concurrency = c
	r.configMu.Unlock()
	r.limiter.SetTarget(c)
}
