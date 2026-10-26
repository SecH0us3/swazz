// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package sstistore

import (
	"sync"

	"swazz-engine/internal/boundedmap"
)

// DefaultMaxEntries bounds a run's SSTI store. Each randomized probe registers its own expression
// until the run ends; past this the least recently registered are dropped first.
const DefaultMaxEntries = 20_000

type SSTIContext struct {
	RawExpr  string // e.g. "23*37"
	Expected string // e.g. "851"
}

// Store maps the randomized SSTI payloads a run sent to the result they evaluate to. Each run owns
// its own store (runner.Runner), so concurrent runs cannot clear each other's expressions. A nil
// *Store holds nothing: it records no expression and matches no payload.
type Store struct {
	mu      sync.RWMutex
	m       *boundedmap.Map[string, SSTIContext]
	onDrop  func() // called on the first drop after the store is made or cleared
	dropped bool
}

func NewStore() *Store {
	return NewStoreWithLimit(DefaultMaxEntries)
}

// NewStoreWithLimit makes a store that keeps at most limit payloads (at least 1).
func NewStoreWithLimit(limit int) *Store {
	return &Store{m: boundedmap.New[string, SSTIContext](limit)}
}

// OnFirstDrop sets fn to be called, outside the store's lock, the first time a full store drops an
// expression after it is made or cleared, so the run can tell its user that some probes go unchecked.
func (s *Store) OnFirstDrop(fn func()) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onDrop = fn
}

// Register records a payload. A full store drops its least recently registered payload for it; a
// response to that payload is then not checked for its expression. The limit counts payloads, not
// bytes.
func (s *Store) Register(payload string, ctx SSTIContext) {
	if s == nil {
		return
	}
	s.mu.Lock()
	var notify func()
	if s.m.Set(payload, ctx) && !s.dropped {
		s.dropped = true
		notify = s.onDrop
	}
	s.mu.Unlock()
	if notify != nil {
		notify()
	}
}

func (s *Store) Get(payload string) (SSTIContext, bool) {
	if s == nil {
		return SSTIContext{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.m.Get(payload)
}

func (s *Store) Clear() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m.Clear()
	s.dropped = false
}
