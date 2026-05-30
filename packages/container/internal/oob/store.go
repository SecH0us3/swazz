package oob

import (
	"sync"
)

type OOBContext struct {
	SessionID string
	Endpoint  string
	Payload   any
}

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
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[uuid] = ctx
}

func (s *Store) GetAndRemoveUUID(uuid string) (*OOBContext, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ctx, ok := s.m[uuid]
	if ok {
		delete(s.m, uuid)
	}
	return ctx, ok
}

// GlobalStore is a singleton for tracking OOB interactions across the application
var GlobalStore = NewStore()
