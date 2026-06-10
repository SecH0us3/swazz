package runner

import (
	"context"
	"sync"
)

type ConcurrencyLimiter struct {
	mu       sync.Mutex
	waitChan chan struct{} // Closed and recreated to notify waiters
	target   int
	current  int
	waiters  int
}

func NewConcurrencyLimiter(initial int) *ConcurrencyLimiter {
	if initial <= 0 {
		initial = 5
	}
	if initial > 1000 {
		initial = 1000
	}
	l := &ConcurrencyLimiter{
		target:   initial,
		waitChan: make(chan struct{}),
	}
	return l
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
	if l.waiters > 0 {
		close(l.waitChan)
		l.waitChan = make(chan struct{})
	}
	l.mu.Unlock()
}

func (l *ConcurrencyLimiter) GetTarget() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.target
}

func (l *ConcurrencyLimiter) Acquire(ctx context.Context) error {
	for {
		l.mu.Lock()
		if l.current < l.target {
			l.current++
			l.mu.Unlock()
			return nil
		}
		ch := l.waitChan
		l.waiters++
		l.mu.Unlock()

		select {
		case <-ch:
			l.mu.Lock()
			l.waiters--
			l.mu.Unlock()
		case <-ctx.Done():
			l.mu.Lock()
			l.waiters--
			l.mu.Unlock()
			return ctx.Err()
		}
	}
}

func (l *ConcurrencyLimiter) Release() {
	l.mu.Lock()
	l.current--
	if l.waiters > 0 {
		close(l.waitChan)
		l.waitChan = make(chan struct{})
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
