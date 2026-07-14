package sstistore

import "sync"

type SSTIContext struct {
	RawExpr  string // e.g. "23*37"
	Expected string // e.g. "851"
}

type Store struct {
	mu sync.RWMutex
	m  map[string]SSTIContext
}

func NewStore() *Store {
	return &Store{
		m: make(map[string]SSTIContext),
	}
}

func (s *Store) Register(payload string, ctx SSTIContext) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[payload] = ctx
}

func (s *Store) Get(payload string) (SSTIContext, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ctx, ok := s.m[payload]
	return ctx, ok
}

func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m = make(map[string]SSTIContext)
}

var GlobalStore = NewStore()
