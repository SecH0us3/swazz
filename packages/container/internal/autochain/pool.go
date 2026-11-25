// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package autochain

import (
	"bytes"
	"encoding/json"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	tidwallgjson "github.com/tidwall/gjson"

	"swazz-engine/internal/swagger"
)

const (
	MaxEntriesPerKey      = 32
	MaxValueLen           = 256
	MaxConsecutiveMisses  = 2
	MaxReseedsPerProducer = 3
	maxJSONWalkDepth      = 16
)

// PinnedBinding tracks a live pooled value injected into a request so 404/410 responses
// can attribute strikes and active parameter fuzzing can drop unpinned fields.
type PinnedBinding struct {
	PoolKey   string
	StrVal    string
	Location  ParamLocation
	ParamPath []string
}

type poolEntry struct {
	strVal  string
	rawVal  any
	misses  int
	parents map[string]string
}

type keyBucket struct {
	entries    []poolEntry
	hadEntries bool
	cursor     atomic.Uint64
}

// Pool is a concurrency-safe bounded store of live resource IDs and stateful tokens.
type Pool struct {
	mu      sync.RWMutex
	buckets map[string]*keyBucket
	reseeds map[int]int
}

// NewPool creates an empty bounded Pool.
func NewPool() *Pool {
	return &Pool{
		buckets: make(map[string]*keyBucket),
		reseeds: make(map[int]int),
	}
}

// Put inserts or refreshes a value under poolKey, evicting the oldest entry if over MaxEntriesPerKey.
func (p *Pool) Put(poolKey, strVal string, rawVal any) {
	p.PutWithParents(poolKey, strVal, rawVal, nil)
}

// PutWithParents inserts or refreshes a value under poolKey along with the parent pool bindings
// that were active when the resource was created, keeping multi-hop ID tuples consistent.
func (p *Pool) PutWithParents(poolKey, strVal string, rawVal any, parents map[string]string) {
	if p == nil || poolKey == "" || !isValidChainScalar(strVal) {
		return
	}
	if rawVal == nil {
		rawVal = strVal
	}
	var clonedParents map[string]string
	if len(parents) > 0 {
		clonedParents = maps.Clone(parents)
	}

	p.mu.Lock()
	p.putLocked(poolKey, strVal, rawVal, clonedParents)
	p.mu.Unlock()
}

func (p *Pool) putLocked(poolKey, strVal string, rawVal any, clonedParents map[string]string) {
	if poolKey == "" || !isValidChainScalar(strVal) {
		return
	}
	if rawVal == nil {
		rawVal = strVal
	}

	b := p.buckets[poolKey]
	if b == nil {
		b = &keyBucket{entries: make([]poolEntry, 0, 8)}
		p.buckets[poolKey] = b
	}
	b.hadEntries = true

	for i := range b.entries {
		if b.entries[i].strVal == strVal {
			b.entries[i].misses = 0
			b.entries[i].rawVal = rawVal
			if clonedParents != nil {
				b.entries[i].parents = clonedParents
			}
			return
		}
	}
	entry := poolEntry{strVal: strVal, rawVal: rawVal, parents: clonedParents}
	if len(b.entries) >= MaxEntriesPerKey {
		copy(b.entries, b.entries[1:])
		b.entries[len(b.entries)-1] = entry
		return
	}
	b.entries = append(b.entries, entry)
}

// GetCoerced returns a round-robin entry from poolKey coerced to match schema.Type.
func (p *Pool) GetCoerced(poolKey string, schema *swagger.SchemaProperty) (any, string, bool) {
	coerced, strVal, _, ok := p.GetEntryCoerced(poolKey, schema)
	return coerced, strVal, ok
}

// GetEntryCoerced returns a round-robin entry coerced to schema.Type together with any recorded parent pins.
func (p *Pool) GetEntryCoerced(poolKey string, schema *swagger.SchemaProperty) (any, string, map[string]string, bool) {
	if p == nil {
		return nil, "", nil, false
	}
	p.mu.RLock()
	b := p.buckets[poolKey]
	if b == nil || len(b.entries) == 0 {
		p.mu.RUnlock()
		return nil, "", nil, false
	}
	idx := b.cursor.Add(1) - 1
	entry := b.entries[idx%uint64(len(b.entries))]
	p.mu.RUnlock()

	return coerceEntry(entry, schema), entry.strVal, entry.parents, true
}

// TakeSacrificial pops the newest live entry from poolKey so destructive DELETE calls
// never leave a deleted ID in the shared pool.
func (p *Pool) TakeSacrificial(poolKey string, schema *swagger.SchemaProperty) (any, string, bool) {
	coerced, strVal, _, ok := p.TakeSacrificialEntry(poolKey, schema)
	return coerced, strVal, ok
}

// TakeSacrificialEntry pops the newest live entry from poolKey together with its recorded parent pins.
func (p *Pool) TakeSacrificialEntry(poolKey string, schema *swagger.SchemaProperty) (any, string, map[string]string, bool) {
	return p.TakeSacrificialEntryIfMoreThan(poolKey, schema, 0)
}

// TakeSacrificialEntryIfMoreThan atomically verifies that poolKey has strictly more than
// minRemaining live entries and pops the newest entry under a single write lock, eliminating
// TOCTOU races that could otherwise drain the last surviving shared ID.
func (p *Pool) TakeSacrificialEntryIfMoreThan(poolKey string, schema *swagger.SchemaProperty, minRemaining int) (any, string, map[string]string, bool) {
	if p == nil {
		return nil, "", nil, false
	}
	p.mu.Lock()
	b := p.buckets[poolKey]
	if b == nil || len(b.entries) <= minRemaining {
		p.mu.Unlock()
		return nil, "", nil, false
	}
	last := len(b.entries) - 1
	entry := b.entries[last]
	b.entries[last] = poolEntry{}
	b.entries = b.entries[:last]
	p.mu.Unlock()

	return coerceEntry(entry, schema), entry.strVal, entry.parents, true
}

// CoerceString coerces a raw string scalar into the Go type expected by schema.
func CoerceString(strVal string, schema *swagger.SchemaProperty) any {
	return coerceEntry(poolEntry{strVal: strVal, rawVal: toTypedScalar(strVal)}, schema)
}

// RecordMiss increments the consecutive 404/410 miss counter and evicts at MaxConsecutiveMisses.
func (p *Pool) RecordMiss(poolKey, strVal string) {
	if p == nil || poolKey == "" || strVal == "" {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()

	b := p.buckets[poolKey]
	if b == nil {
		return
	}
	for i := range b.entries {
		if b.entries[i].strVal == strVal {
			b.entries[i].misses++
			if b.entries[i].misses >= MaxConsecutiveMisses {
				b.entries = slices.Delete(b.entries, i, i+1)
			}
			return
		}
	}
}

// RecordHit resets any accumulated consecutive miss strikes on a live entry after a 2xx response.
func (p *Pool) RecordHit(poolKey, strVal string) {
	if p == nil || poolKey == "" || strVal == "" {
		return
	}
	p.mu.RLock()
	b := p.buckets[poolKey]
	hasMisses := false
	if b != nil {
		for i := range b.entries {
			if b.entries[i].strVal == strVal {
				hasMisses = b.entries[i].misses > 0
				break
			}
		}
	}
	p.mu.RUnlock()
	if !hasMisses {
		return
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	b = p.buckets[poolKey]
	if b == nil {
		return
	}
	for i := range b.entries {
		if b.entries[i].strVal == strVal {
			b.entries[i].misses = 0
			return
		}
	}
}

// LiveCount returns the number of currently active entries under poolKey.
func (p *Pool) LiveCount(poolKey string) int {
	if p == nil {
		return 0
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	if b := p.buckets[poolKey]; b != nil {
		return len(b.entries)
	}
	return 0
}

// HadEntries reports whether poolKey ever held at least one harvested value during this run.
func (p *Pool) HadEntries(poolKey string) bool {
	if p == nil {
		return false
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	if b := p.buckets[poolKey]; b != nil {
		return b.hadEntries
	}
	return false
}

// TryAcquireReseed reserves 1 unit of the producer's re-seed budget (capped at MaxReseedsPerProducer).
func (p *Pool) TryAcquireReseed(producerIdx int) bool {
	if p == nil || producerIdx < 0 {
		return false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.reseeds[producerIdx] >= MaxReseedsPerProducer {
		return false
	}
	p.reseeds[producerIdx]++
	return true
}

// HarvestResponse extracts scalar values from a 2xx response according to rules, Location header,
// and JSON ID heuristics, filtering out request echoes.
func (p *Pool) HarvestResponse(rules []ProducerRule, headers http.Header, rawBody []byte, sent ...any) {
	p.HarvestResponseWithParents(rules, headers, rawBody, nil, sent...)
}

// HarvestResponseWithParents extracts scalar values from a 2xx response and associates each entry
// with the parent pool bindings that were active on the creating request.
func (p *Pool) HarvestResponseWithParents(rules []ProducerRule, headers http.Header, rawBody []byte, parentPins map[string]string, sent ...any) {
	if p == nil || len(rules) == 0 {
		return
	}

	var echoed map[string]bool
	for _, s := range sent {
		if s == nil {
			continue
		}
		walkSentScalars(s, 0, func(k, v string) {
			if echoed == nil {
				echoed = make(map[string]bool, 8)
			}
			echoed[strings.ToLower(k)+"\x00"+v] = true
		})
	}

	locID := extractLocationID(headers)
	var parsedBody any
	bodyDecoded := false
	ensureDecoded := func() any {
		if !bodyDecoded {
			bodyDecoded = true
			if len(rawBody) > 0 {
				dec := json.NewDecoder(bytes.NewReader(rawBody))
				dec.UseNumber()
				_ = dec.Decode(&parsedBody)
			}
		}
		return parsedBody
	}

	type harvestedItem struct {
		poolKey string
		strVal  string
		rawVal  any
	}
	var batchBuf [8]harvestedItem
	batch := batchBuf[:0]
	queue := func(poolKey, strVal string, rawVal any) {
		if poolKey == "" || !isValidChainScalar(strVal) {
			return
		}
		batch = append(batch, harvestedItem{poolKey: poolKey, strVal: strVal, rawVal: rawVal})
	}

	for _, rule := range rules {
		if rule.ResponseExpr != "" {
			if strings.HasPrefix(rule.ResponseExpr, "$header.") {
				hName := strings.TrimPrefix(rule.ResponseExpr, "$header.")
				if strings.EqualFold(hName, "Location") {
					if locID != "" {
						queue(rule.PoolKey, locID, toTypedScalar(locID))
					}
				} else if hv := headers.Get(hName); hv != "" {
					queue(rule.PoolKey, hv, hv)
				}
				continue
			}
			if len(rawBody) > 0 {
				res := tidwallgjson.GetBytes(rawBody, rule.ResponseExpr)
				if res.Exists() && res.Type != tidwallgjson.Null && !res.IsObject() && !res.IsArray() {
					str := res.String()
					leaf := rule.ResponseExpr
					if dot := strings.LastIndexByte(leaf, '.'); dot >= 0 {
						leaf = leaf[dot+1:]
					}
					if !echoed[strings.ToLower(leaf)+"\x00"+str] {
						queue(rule.PoolKey, str, gjsonScalarValue(res))
					}
				}
			}
			continue
		}

		// Heuristic ID scan: JSON body first, then Location header
		if root := ensureDecoded(); root != nil {
			walkJSONIDs(root, 0, func(key, str string, raw any) {
				if !echoed[strings.ToLower(key)+"\x00"+str] {
					queue(rule.PoolKey, str, raw)
				}
			})
		}
		if locID != "" {
			if colSeg := resourceCollectionSegment(rule.PoolKey); colSeg == "" || !strings.EqualFold(locID, colSeg) {
				queue(rule.PoolKey, locID, toTypedScalar(locID))
			}
		}
	}

	if len(batch) == 0 {
		return
	}
	var clonedParents map[string]string
	if len(parentPins) > 0 {
		clonedParents = maps.Clone(parentPins)
	}
	p.mu.Lock()
	for _, item := range batch {
		p.putLocked(item.poolKey, item.strVal, item.rawVal, clonedParents)
	}
	p.mu.Unlock()
}

func resourceCollectionSegment(poolKey string) string {
	if !strings.HasPrefix(poolKey, "res:") {
		return ""
	}
	trimmed := strings.TrimSuffix(strings.TrimPrefix(poolKey, "res:"), ":id")
	if trimmed == "" {
		return ""
	}
	if slash := strings.LastIndexByte(trimmed, '/'); slash >= 0 {
		return trimmed[slash+1:]
	}
	return trimmed
}

func extractLocationID(headers http.Header) string {
	if headers == nil {
		return ""
	}
	loc := strings.TrimSpace(headers.Get("Location"))
	if loc == "" {
		return ""
	}
	u, err := url.Parse(loc)
	if err != nil {
		return ""
	}
	segs := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(segs) == 0 {
		return ""
	}
	last := segs[len(segs)-1]
	if last == "." || last == ".." || strings.EqualFold(last, "%2e") || strings.EqualFold(last, "%2e%2e") {
		return ""
	}
	if dec, err := url.PathUnescape(last); err == nil && (dec == "." || dec == "..") {
		return ""
	}
	if isValidChainScalar(last) && !isVersionOrRootPrefix(last) {
		return last
	}
	return ""
}

func walkJSONIDs(v any, depth int, fn func(key, str string, raw any)) {
	if depth > maxJSONWalkDepth || v == nil {
		return
	}
	switch node := v.(type) {
	case map[string]any:
		// Deterministic key walk so pool insertion order is reproducible
		keys := make([]string, 0, len(node))
		for k := range node {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		// Prefer top-level "id" / "uuid" first
		for _, primary := range []string{"id", "ID", "uuid", "_id"} {
			if val, ok := node[primary]; ok {
				if str, raw, ok := scalarFromJSON(val); ok {
					fn(primary, str, raw)
				}
			}
		}
		for _, k := range keys {
			val := node[k]
			c := canonicalSnake(k)
			if c == "id" || c == "uuid" || strings.HasSuffix(c, "_id") || strings.HasSuffix(c, "_uuid") {
				if str, raw, ok := scalarFromJSON(val); ok {
					fn(k, str, raw)
					continue
				}
			}
			walkJSONIDs(val, depth+1, fn)
		}
	case []any:
		limit := min(len(node), 5)
		for i := range limit {
			walkJSONIDs(node[i], depth+1, fn)
		}
	}
}

func walkSentScalars(v any, depth int, fn func(key, str string)) {
	if depth > maxJSONWalkDepth || v == nil {
		return
	}
	switch node := v.(type) {
	case map[string]any:
		for k, val := range node {
			if str, _, ok := scalarFromJSON(val); ok {
				fn(k, str)
			} else {
				walkSentScalars(val, depth+1, fn)
			}
		}
	case []any:
		for _, item := range node {
			walkSentScalars(item, depth+1, fn)
		}
	}
}

func scalarFromJSON(v any) (string, any, bool) {
	switch t := v.(type) {
	case string:
		if !isValidChainScalar(t) {
			return "", nil, false
		}
		return t, t, true
	case json.Number:
		s := t.String()
		if !isValidChainScalar(s) {
			return "", nil, false
		}
		if iv, err := t.Int64(); err == nil {
			return s, iv, true
		}
		if fv, err := t.Float64(); err == nil {
			return s, fv, true
		}
		return s, s, true
	case int:
		s := strconv.Itoa(t)
		return s, int64(t), true
	case int64:
		s := strconv.FormatInt(t, 10)
		return s, t, true
	case float64:
		s := strconv.FormatFloat(t, 'f', -1, 64)
		return s, t, true
	}
	return "", nil, false
}

func gjsonScalarValue(r tidwallgjson.Result) any {
	if r.Type == tidwallgjson.Number {
		if iv, err := strconv.ParseInt(r.Raw, 10, 64); err == nil {
			return iv
		}
		return r.Float()
	}
	return r.String()
}

func toTypedScalar(s string) any {
	if iv, err := strconv.ParseInt(s, 10, 64); err == nil {
		return iv
	}
	return s
}

func coerceEntry(e poolEntry, schema *swagger.SchemaProperty) any {
	if schema == nil {
		return e.rawVal
	}
	switch schema.Type {
	case "integer":
		if iv, ok := e.rawVal.(int64); ok {
			return iv
		}
		if iv, err := strconv.ParseInt(e.strVal, 10, 64); err == nil {
			return iv
		}
	case "number":
		switch tv := e.rawVal.(type) {
		case float64:
			return tv
		case int64:
			return float64(tv)
		}
		if fv, err := strconv.ParseFloat(e.strVal, 64); err == nil {
			return fv
		}
	case "string":
		return e.strVal
	}
	return e.rawVal
}

func isValidChainScalar(s string) bool {
	if len(s) == 0 || len(s) > MaxValueLen {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < 0x20 || s[i] == 0x7f {
			return false
		}
	}
	return true
}
