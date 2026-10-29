// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Package boundedmap is a map with a size limit that drops its least recently set entries first.
package boundedmap

import "container/list"

// Map keeps at most a fixed number of entries. Setting a key, new or not, makes it the most
// recent; past the limit the least recent entry is dropped. It is not safe for concurrent use.
type Map[K comparable, V any] struct {
	limit int
	ll    *list.List // front: least recently set
	idx   map[K]*list.Element
}

type entry[K comparable, V any] struct {
	key K
	val V
}

// New makes a map that keeps at most limit entries (at least 1).
func New[K comparable, V any](limit int) *Map[K, V] {
	if limit < 1 {
		limit = 1
	}
	return &Map[K, V]{limit: limit, ll: list.New(), idx: make(map[K]*list.Element)}
}

// Set stores v under k as the most recent entry and reports whether that dropped another one.
func (m *Map[K, V]) Set(k K, v V) (dropped bool) {
	if el, ok := m.idx[k]; ok {
		el.Value.(*entry[K, V]).val = v
		m.ll.MoveToBack(el)
		return false
	}
	m.idx[k] = m.ll.PushBack(&entry[K, V]{key: k, val: v})
	if m.ll.Len() > m.limit {
		oldest := m.ll.Front()
		m.ll.Remove(oldest)
		delete(m.idx, oldest.Value.(*entry[K, V]).key)
		return true
	}
	return false
}

func (m *Map[K, V]) Get(k K) (V, bool) {
	if el, ok := m.idx[k]; ok {
		return el.Value.(*entry[K, V]).val, true
	}
	var zero V
	return zero, false
}

func (m *Map[K, V]) Delete(k K) (V, bool) {
	el, ok := m.idx[k]
	if !ok {
		var zero V
		return zero, false
	}
	m.ll.Remove(el)
	delete(m.idx, k)
	return el.Value.(*entry[K, V]).val, true
}

func (m *Map[K, V]) Len() int { return m.ll.Len() }

// NewestKeys returns the keys of at most n entries, the most recently set first.
func (m *Map[K, V]) NewestKeys(n int) []K {
	out := make([]K, 0, min(max(n, 0), m.ll.Len()))
	for el := m.ll.Back(); el != nil && len(out) < n; el = el.Prev() {
		out = append(out, el.Value.(*entry[K, V]).key)
	}
	return out
}

func (m *Map[K, V]) Clear() {
	m.ll.Init()
	m.idx = make(map[K]*list.Element)
}
