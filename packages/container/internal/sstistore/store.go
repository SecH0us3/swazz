// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package sstistore

import "sync"

type SSTIContext struct {
	RawExpr  string // e.g. "23*37"
	Expected string // e.g. "851"
}

// Store maps the randomized SSTI payloads a run sent to the result they evaluate to. Each run owns
// its own store (runner.Runner), so concurrent runs cannot clear each other's expressions. A nil
// *Store holds nothing: it records no expression and matches no payload.
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
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[payload] = ctx
}

func (s *Store) Get(payload string) (SSTIContext, bool) {
	if s == nil {
		return SSTIContext{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	ctx, ok := s.m[payload]
	return ctx, ok
}

func (s *Store) Clear() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m = make(map[string]SSTIContext)
}
