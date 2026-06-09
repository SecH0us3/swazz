package runner

import "sync"

type ConcurrencyLimiter struct {
	mu      sync.Mutex
	cond    *sync.Cond
	target  int
	current int
}

func NewConcurrencyLimiter(initial int) *ConcurrencyLimiter {
	if initial <= 0 {
		initial = 5
	}
	if initial > 1000 {
		initial = 1000
	}
	l := &ConcurrencyLimiter{target: initial}
	l.cond = sync.NewCond(&l.mu)
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
	l.cond.Broadcast()
	l.mu.Unlock()
}

func (l *ConcurrencyLimiter) GetTarget() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.target
}

func (l *ConcurrencyLimiter) Acquire() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for l.current >= l.target {
		l.cond.Wait()
	}
	l.current++
}

func (l *ConcurrencyLimiter) Release() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.current--
	l.cond.Signal()
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
