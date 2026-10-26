// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package oob

import (
	"swazz-engine/internal/boundedmap"
	"swazz-engine/internal/swagger"
	"sync"
)

// DefaultMaxEntries bounds a run's OOB store. Every OOB payload registers a token that waits for a
// callback until the run ends, so a long scan would otherwise grow the store without limit. Past
// this the least recently registered tokens are dropped, and a late callback for one of them is
// not matched.
const DefaultMaxEntries = 50_000

type OOBContext struct {
	SessionID string
	Endpoint  string
	Payload   any
	Request   *swagger.RequestLog
}

// Store tracks the OOB tokens one run has sent, until the target calls back. Each run owns its
// own store (runner.Runner): a store shared by concurrent runs lets one run's start or end wipe
// the tokens another run is still waiting on. A nil *Store holds nothing: it records no token and
// matches no callback.
type Store struct {
	mu      sync.RWMutex
	m       *boundedmap.Map[string, *OOBContext]
	onDrop  func() // called on the first drop after the store is made or cleared
	dropped bool
}

func NewStore() *Store {
	return NewStoreWithLimit(DefaultMaxEntries)
}

// NewStoreWithLimit makes a store that keeps at most limit tokens (at least 1).
func NewStoreWithLimit(limit int) *Store {
	return &Store{m: boundedmap.New[string, *OOBContext](limit)}
}

// OnFirstDrop sets fn to be called, outside the store's lock, the first time a full store drops a
// token after it is made or cleared, so the run can tell its user that late callbacks are lost.
func (s *Store) OnFirstDrop(fn func()) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onDrop = fn
}

// RegisterUUID records a token. A full store drops its least recently registered token for it;
// a callback for that token is then not matched. The limit counts tokens, not bytes.
func (s *Store) RegisterUUID(uuid string, ctx *OOBContext) {
	if s == nil {
		return
	}
	s.mu.Lock()
	var notify func()
	if s.m.Set(uuid, ctx) && !s.dropped {
		s.dropped = true
		notify = s.onDrop
	}
	s.mu.Unlock()
	if notify != nil {
		notify()
	}
}

func (s *Store) UpdateRequest(uuid string, req *swagger.RequestLog) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx, ok := s.m.Get(uuid); ok {
		ctx.Request = req
	}
}

func (s *Store) GetAndRemoveUUID(uuid string) (*OOBContext, bool) {
	if s == nil {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.m.Delete(uuid)
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

func (s *Store) Size() int {
	if s == nil {
		return 0
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.m.Len()
}
