// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ResponseBodyToBytes normalises a response body ([]byte, string, or arbitrary
// JSON value) into a byte slice for similarity comparison.
func responseBodyToBytes(body any) []byte {
	if body == nil {
		return nil
	}
	switch v := body.(type) {
	case []byte:
		return v
	case string:
		return []byte(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil
		}
		return b
	}
}

// HarvestIDs recursively collects ID-like values from a JSON response body.
func harvestIDs(data any, ids map[string]bool) {
	walkIDFields(data, func(_, id string) { ids[id] = true })
}

// walkIDFields calls fn with every scalar value under an ID-like key in data, at any depth,
// formatted by formatIDScalar.
func walkIDFields(data any, fn func(key, id string)) {
	walkScalars(data, func(key, id string) {
		if isIDParam(key) {
			fn(key, id)
		}
	})
}

// walkScalars calls fn with every string or number in data that is the value of a map key, at
// any depth, with that key and its formatIDScalar form. Array items take the array's key.
func walkScalars(data any, fn func(key, id string)) {
	var walk func(key string, v any)
	walk = func(key string, v any) {
		switch val := v.(type) {
		case map[string]any:
			for k, x := range val {
				walk(k, x)
			}
		case []any:
			for _, x := range val {
				walk(key, x)
			}
		default:
			if id, ok := formatIDScalar(val); ok && key != "" {
				fn(key, id)
			}
		}
	}
	walk("", data)
}

// formatIDScalar is the one text form of a scalar ID value; ok is false for other types and for
// the empty string.
func formatIDScalar(v any) (string, bool) {
	switch typed := v.(type) {
	case string:
		return typed, typed != ""
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64), true
	case int:
		return strconv.Itoa(typed), true
	case int64:
		return strconv.FormatInt(typed, 10), true
	}
	return "", false
}

// HarvestFromResponse extracts IDs and explicit variables from a successful
// response body and records them for the BOLA replay phase. sent is what the request carried
// (body, query params): a value the response merely echoes back is the fuzzer's own, not an ID.
func (d *Detector) HarvestFromResponse(originalPath, method string, respStatus int, respBody any, sent ...any) {
	d.harvest(originalPath, method, respStatus, respBody, true, sent...)
}

// ExtractVariablesFromResponse extracts only the endpoint's explicit variables. It is for a
// response to a fuzz payload the target may echo (malicious, boundary): its ID-like fields can
// hold that payload, and harvested IDs are kept first-come up to a cap, so junk would crowd out
// real IDs for the rest of the run.
func (d *Detector) ExtractVariablesFromResponse(originalPath, method string, respStatus int, respBody any) {
	d.harvest(originalPath, method, respStatus, respBody, false)
}

func (d *Detector) harvest(originalPath, method string, respStatus int, respBody any, withIDs bool, sent ...any) {
	if respStatus < 200 || respStatus >= 300 || respBody == nil {
		return
	}

	ep, found := d.findEndpointConfig(originalPath, method)
	if !found {
		return
	}

	// 1. Explicit JSONPath → variable mapping. The config write lock is taken only when a value
	// changed: UnlockConfig rebuilds the variable replacer, and every worker waits on it.
	if len(ep.ExtractVariables) > 0 {
		extracted := make(map[string]any, len(ep.ExtractVariables))
		for jsonPath, varName := range ep.ExtractVariables {
			if val := extractJSONPathExtended(respBody, jsonPath); val != nil {
				extracted[varName] = val
				d.ctx.LogDebug("[BOLA] Extracted variable %s = %v from response of %s %s",
					varName, val, method, originalPath)
			}
		}
		if len(extracted) > 0 {
			d.ctx.RLockConfig()
			for k, v := range extracted {
				if reflect.DeepEqual(d.ctx.Config().Variables[k], v) {
					delete(extracted, k) // unchanged: no need to rebuild the replacer for it
				}
			}
			d.ctx.RUnlockConfig()
		}
		if len(extracted) > 0 {
			d.ctx.LockConfig()
			if d.ctx.Config().Variables == nil {
				d.ctx.Config().Variables = map[string]any{}
			}
			for k, v := range extracted {
				d.ctx.Config().Variables[k] = v
			}
			d.ctx.UnlockConfig()
		}
	}

	if !withIDs {
		return
	}

	// 2. Heuristic ID harvesting.
	prefix := getPathPrefix(originalPath)
	if val, ok := d.harvestedIDs.Load(prefix); ok && len(val.([]string)) >= maxHarvestedIDsPerPrefix {
		return // full: nothing more is kept for this prefix, so the body is not walked
	}
	// A value the response returns under the same key the request sent it is an echo of the
	// fuzzer's own value, not an ID ({"ownerId":"xK9"} back for {"ownerId":"xK9"}). Matching on
	// the key too keeps real IDs that merely equal some other sent value (?page=1 and order 1).
	echoed := make(map[string]bool)
	for _, v := range sent {
		walkScalars(v, func(key, id string) { echoed[strings.ToLower(key)+"\x00"+id] = true })
	}
	harvested := make(map[string]bool)
	walkIDFields(respBody, func(key, id string) {
		if !echoed[strings.ToLower(key)+"\x00"+id] {
			harvested[id] = true
		}
	})
	if len(harvested) == 0 {
		return
	}

	newIDs := make([]string, 0, len(harvested))
	for id := range harvested {
		if isReplayableID(id) {
			newIDs = append(newIDs, id)
		}
	}
	if len(newIDs) == 0 {
		return
	}
	sort.Strings(newIDs)

	d.ctx.LockResults()
	var existing []string
	if val, ok := d.harvestedIDs.Load(prefix); ok {
		existing = val.([]string)
	}
	merged, added := appendUniqueCapped(existing, newIDs, maxHarvestedIDsPerPrefix)
	if len(added) > 0 {
		d.harvestedIDs.Store(prefix, merged)
	}
	d.ctx.UnlockResults()

	source := fmt.Sprintf("%s %s", method, originalPath)
	for _, id := range added {
		d.idSources.LoadOrStore(id, source)
	}
	if len(added) > 0 {
		d.ctx.LogDebug("[BOLA] Harvested IDs for prefix %s: %v", prefix, added)
	}
}

// Harvested IDs come from the target's responses, so the target controls them, and the BOLA
// phase replays them in request paths and bodies. These bounds keep that replay what it is
// meant to be: a bounded number of literal ID values.
const (
	// maxHarvestedIDLen drops values too long to be a resource ID.
	maxHarvestedIDLen = 128
	// maxHarvestedIDsPerPrefix bounds the IDs kept per path prefix for the whole run; IDs past it
	// are ignored, so a list endpoint hit thousands of times costs nothing more.
	maxHarvestedIDsPerPrefix = 100
)

// isReplayableID reports whether a harvested value is kept for replay: a bounded length, valid
// UTF-8 with no control characters, and not a dot segment ("." and ".." survive path escaping
// and would move the request up the path). The value is escaped wherever it is put in a path.
func isReplayableID(id string) bool {
	if id == "" || len(id) > maxHarvestedIDLen || id == "." || id == ".." || !utf8.ValidString(id) {
		return false
	}
	return !strings.ContainsFunc(id, unicode.IsControl)
}

// appendUniqueCapped appends to existing the values of add it lacks, up to limit entries in all.
// It returns the new slice and the values it added; existing is never modified in place.
func appendUniqueCapped(existing, add []string, limit int) (merged, added []string) {
	if len(existing) >= limit {
		return existing, nil
	}
	seen := make(map[string]bool, len(existing))
	for _, s := range existing {
		seen[s] = true
	}
	for _, s := range add {
		if len(existing)+len(added) >= limit {
			break
		}
		if !seen[s] {
			seen[s] = true
			added = append(added, s)
		}
	}
	if len(added) == 0 {
		return existing, nil
	}
	merged = make([]string, 0, len(existing)+len(added))
	merged = append(merged, existing...)
	merged = append(merged, added...)
	return merged, added
}

// harvestedIDsFor returns up to limit harvested IDs (0: all), those harvested under prefix first,
// then under related prefixes (sharing at least the first two segments), then the others by
// prefix order, without duplicates. An ID from the endpoint's own resource or sibling resource is
// the one most likely to exist there, so it is never crowded out by IDs of unrelated resources.
func (d *Detector) harvestedIDsFor(prefix string, limit int) []string {
	byPrefix := make(map[string][]string)
	var related, other []string
	d.harvestedIDs.Range(func(key, value any) bool {
		p := key.(string)
		byPrefix[p] = value.([]string)
		if p != prefix {
			if arePrefixesRelated(prefix, p) {
				related = append(related, p)
			} else {
				other = append(other, p)
			}
		}
		return true
	})
	sort.Strings(related)
	sort.Strings(other)
	prefixes := make([]string, 0, 1+len(related)+len(other))
	if _, ok := byPrefix[prefix]; ok {
		prefixes = append(prefixes, prefix)
	}
	prefixes = append(prefixes, related...)
	prefixes = append(prefixes, other...)

	seen := make(map[string]bool)
	var out []string
	for _, p := range prefixes {
		for _, id := range byPrefix[p] {
			if limit > 0 && len(out) >= limit {
				return out
			}
			if !seen[id] {
				seen[id] = true
				out = append(out, id)
			}
		}
	}
	return out
}

// ExtractParamsFromPath extracts path parameter values by comparing the URL
// template with a concrete resolved path.
// e.g. template="/api/goods/{id}", resolved="/api/goods/42" → {"id": "42"}.
func extractParamsFromPath(originalPath, resolvedPath string) map[string]string {
	params := map[string]string{}
	origParts := strings.Split(strings.Trim(originalPath, "/"), "/")
	resolParts := strings.Split(strings.Trim(resolvedPath, "/"), "/")
	if len(origParts) != len(resolParts) {
		return params
	}
	for i, part := range origParts {
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			params[part[1:len(part)-1]] = resolParts[i]
		}
	}
	return params
}

// ExtractJSONPathExtended traverses a parsed JSON value using a simple
// dot-separated path with optional array indexing (e.g. "data.items[0].id").
func extractJSONPathExtended(data any, path string) any {
	path = strings.TrimPrefix(strings.TrimPrefix(path, "$"), ".")
	if path == "" {
		return data
	}

	current := data
	for i, part := range strings.Split(path, ".") {
		if current == nil {
			return nil
		}
		key := part
		arrIdx := -1

		if start := strings.IndexByte(part, '['); start >= 0 {
			if end := strings.IndexByte(part, ']'); end > start {
				if idx, err := strconv.Atoi(part[start+1 : end]); err == nil {
					arrIdx = idx
					key = part[:start]
				}
			}
		}

		if key != "" {
			m, ok := current.(map[string]any)
			if !ok {
				return nil
			}
			current = m[key]
		}

		if current != nil && arrIdx >= 0 {
			arr, ok := current.([]any)
			if !ok || arrIdx >= len(arr) {
				return nil
			}
			current = arr[arrIdx]
		}

		if current == nil {
			return nil
		}

		if i == len(strings.Split(path, "."))-1 {
			return current
		}
	}
	return nil
}
