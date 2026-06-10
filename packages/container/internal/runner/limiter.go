package runner

import (
	"context"
	"sync"
)

type ConcurrencyLimiter struct {
	mu      sync.Mutex
	target  int
	current int
	waiters []chan struct{}
}

func NewConcurrencyLimiter(initial int) *ConcurrencyLimiter {
	if initial <= 0 {
		initial = 5
	}
	if initial > 1000 {
		initial = 1000
	}
	return &ConcurrencyLimiter{
		target: initial,
	}
}

func (l *ConcurrencyLimiter) SetTarget(target int) {
	l.mu.Lock()
	if target <= 0 {
		target = 1
	}
	if target > 1000 {
		target = 1000
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

func (r *Runner) SetConcurrency(c int) {
	r.configMu.Lock()
	r.config.Settings.Concurrency = c
	r.configMu.Unlock()
	r.limiter.SetTarget(c)
}
