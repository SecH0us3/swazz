// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
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
	switch val := data.(type) {
	case map[string]any:
		for k, v := range val {
			if isIDParam(k) {
				switch typed := v.(type) {
				case string:
					if typed != "" {
						ids[typed] = true
					}
				case float64:
					ids[strconv.FormatFloat(typed, 'f', -1, 64)] = true
				case int:
					ids[strconv.Itoa(typed)] = true
				case int64:
					ids[strconv.FormatInt(typed, 10)] = true
				}
			}
			harvestIDs(v, ids)
		}
	case []any:
		for _, item := range val {
			harvestIDs(item, ids)
		}
	}
}

// harvestFromResponse extracts IDs and explicit variables from a successful
// response body and records them for the BOLA replay phase.
func (d *Detector) HarvestFromResponse(originalPath, method string, respStatus int, respBody any) {
	if respStatus < 200 || respStatus >= 300 || respBody == nil {
		return
	}

	ep, found := d.findEndpointConfig(originalPath, method)
	if !found {
		return
	}

	// 1. Explicit JSONPath → variable mapping.
	if len(ep.ExtractVariables) > 0 {
		d.ctx.LockConfig()
		if d.ctx.Config().Variables == nil {
			d.ctx.Config().Variables = map[string]any{}
		}
		varsUpdated := false
		for jsonPath, varName := range ep.ExtractVariables {
			if val := extractJSONPathExtended(respBody, jsonPath); val != nil {
				d.ctx.Config().Variables[varName] = val
				varsUpdated = true
				d.ctx.LogDebug("[BOLA] Extracted variable %s = %v from response of %s %s",
					varName, val, method, originalPath)
			}
		}
		d.ctx.UnlockConfig()
		if varsUpdated {
			
		}
	}

	// 2. Heuristic ID harvesting.
	prefix := getPathPrefix(originalPath)
	harvested := make(map[string]bool)
	harvestIDs(respBody, harvested)
	if len(harvested) == 0 {
		return
	}

	newIDs := make([]string, 0, len(harvested))
	for id := range harvested {
		newIDs = append(newIDs, id)
		d.idSources.Store(id, fmt.Sprintf("%s %s", method, originalPath))
	}

	d.ctx.LockResults()
	if val, ok := d.harvestedIDs.Load(prefix); ok {
		existing := val.([]string)
		merged := mergeUniqueStrings(existing, newIDs)
		d.harvestedIDs.Store(prefix, merged)
	} else {
		d.harvestedIDs.Store(prefix, newIDs)
	}
	d.ctx.UnlockResults()

	d.ctx.LogDebug("[BOLA] Harvested IDs for prefix %s: %v", prefix, newIDs)
}

// collectAllHarvestedIDs returns a deduplicated slice of every ID harvested
// across all endpoint prefixes.
func (d *Detector) collectAllHarvestedIDs() []string {
	unique := make(map[string]bool)
	d.harvestedIDs.Range(func(_, value any) bool {
		for _, id := range value.([]string) {
			unique[id] = true
		}
		return true
	})
	out := make([]string, 0, len(unique))
	for id := range unique {
		out = append(out, id)
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
