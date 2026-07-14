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

func (s *Store) UpdateRequest(uuid string, req *swagger.RequestLog) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx, ok := s.m[uuid]; ok {
		ctx.Request = req
	}
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

func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m = make(map[string]*OOBContext)
}

func (s *Store) ClearSession(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range s.m {
		if v.SessionID == sessionID {
			delete(s.m, k)
		}
	}
}

func (s *Store) Size() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.m)
}

// GlobalStore is a singleton for tracking OOB interactions across the application
var GlobalStore = NewStore()
