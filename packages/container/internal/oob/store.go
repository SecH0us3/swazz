// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package oob

import (
	"swazz-engine/internal/swagger"
	"sync"
)

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
	mu sync.RWMutex
	m  map[string]*OOBContext
}

func NewStore() *Store {
	return &Store{
		m: make(map[string]*OOBContext),
	}
}

func (s *Store) RegisterUUID(uuid string, ctx *OOBContext) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[uuid] = ctx
}

func (s *Store) UpdateRequest(uuid string, req *swagger.RequestLog) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx, ok := s.m[uuid]; ok {
		ctx.Request = req
	}
}

func (s *Store) GetAndRemoveUUID(uuid string) (*OOBContext, bool) {
	if s == nil {
		return nil, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	ctx, ok := s.m[uuid]
	if ok {
		delete(s.m, uuid)
	}
	return ctx, ok
}

func (s *Store) Clear() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m = make(map[string]*OOBContext)
}

func (s *Store) Size() int {
	if s == nil {
		return 0
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.m)
}
