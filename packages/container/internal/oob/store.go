// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package oob

import (
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"swazz-engine/internal/boundedmap"
	"swazz-engine/internal/swagger"
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

// PendingToken is a token still waiting for its callback when the run ends, handed to the
// coordinator so a later callback can still be reported.
type PendingToken struct {
	UUID     string `json:"uuid"`
	Endpoint string `json:"endpoint"`
	Payload  string `json:"payload"`
}

// MaxPendingFieldBytes bounds a pending token's endpoint and payload: they only name the probe in
// a finding.
const MaxPendingFieldBytes = 256

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

// TakePending removes and returns at most n tokens still waiting for a callback, the most recently
// registered first, with their endpoint and payload cut to MaxPendingFieldBytes. A callback for a
// taken token is no longer matched here: whoever took it reports it.
func (s *Store) TakePending(n int) []PendingToken {
	if s == nil {
		return nil
	}
	type taken struct {
		uuid string
		ctx  *OOBContext
	}
	s.mu.Lock()
	keys := s.m.NewestKeys(n)
	all := make([]taken, 0, len(keys))
	for _, k := range keys {
		if ctx, _ := s.m.Delete(k); ctx != nil {
			all = append(all, taken{k, ctx})
		}
	}
	s.mu.Unlock()

	// Formatted outside the lock: callbacks and registrations must not wait on it.
	out := make([]PendingToken, 0, len(all))
	for _, t := range all {
		out = append(out, PendingToken{
			UUID:     t.uuid,
			Endpoint: cutUTF8(t.ctx.Endpoint, MaxPendingFieldBytes),
			Payload:  cutUTF8(payloadText(t.ctx.Payload), MaxPendingFieldBytes),
		})
	}
	return out
}

// payloadText is a payload as text. A string payload, the usual case, is used as is; anything
// else is formatted, up to a bound past which the cut drops it anyway.
func payloadText(p any) string {
	if s, ok := p.(string); ok {
		return s
	}
	w := &cappedWriter{limit: MaxPendingFieldBytes + utf8.UTFMax}
	_, _ = fmt.Fprint(w, p)
	return w.b.String()
}

// cappedWriter keeps the first limit bytes written to it and discards the rest.
type cappedWriter struct {
	b     strings.Builder
	limit int
}

func (w *cappedWriter) Write(p []byte) (int, error) {
	if room := w.limit - w.b.Len(); room > 0 {
		w.b.Write(p[:min(room, len(p))])
	}
	return len(p), nil
}

// cutUTF8 cuts s to at most n bytes without splitting a character.
func cutUTF8(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// A rune is at most UTFMax bytes: backing off further would only eat invalid bytes.
	for i := 0; i < utf8.UTFMax-1 && n > 0 && !utf8.RuneStart(s[n]); i++ {
		n--
	}
	return s[:n]
}
