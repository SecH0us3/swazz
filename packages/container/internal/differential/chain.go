// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package differential

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"swazz-engine/internal/swagger"
)

// HarvestedResource represents an entity created during scanning.
type HarvestedResource struct {
	ID                  string            `json:"id"`
	PathPrefix          string            `json:"path_prefix"`
	EndpointPath        string            `json:"endpoint_path"`
	Method              string            `json:"method"`
	CreatorIdentity     string            `json:"creator_identity"`
	BaselineBody        []byte            `json:"baseline_body"`
	BaselineFingerprint SchemaFingerprint `json:"baseline_fingerprint"`
	CreatedAt           time.Time         `json:"created_at"`
}

// ProbeCandidate represents a cross-identity replay target to verify access isolation.
type ProbeCandidate struct {
	TargetEndpoint      swagger.EndpointConfig `json:"target_endpoint"`
	ResolvedPath        string                 `json:"resolved_path"`
	HarvestedID         string                 `json:"harvested_id"`
	CreatorIdentity     string                 `json:"creator_identity"`
	ProbeIdentity       string                 `json:"probe_identity"` // e.g. "UserB" or "Anonymous"
	BaselineFingerprint SchemaFingerprint      `json:"baseline_fingerprint"`
}

// ChainHarvester tracks stateful entities created during fuzzing runs.
type ChainHarvester struct {
	mu        sync.RWMutex
	resources []HarvestedResource
	seenIDs   map[string]bool
}

// NewChainHarvester creates a thread-safe harvester for stateful entity tracking.
func NewChainHarvester() *ChainHarvester {
	return &ChainHarvester{
		resources: make([]HarvestedResource, 0),
		seenIDs:   make(map[string]bool),
	}
}

// RecordCreation inspects a response from a POST or PUT endpoint and records any generated IDs.
func (h *ChainHarvester) RecordCreation(
	endpoint swagger.EndpointConfig,
	respBody []byte,
	respStatus int,
	creatorIdentity string,
) {
	if respStatus < 200 || respStatus >= 300 || len(respBody) == 0 {
		return
	}

	upperMethod := strings.ToUpper(endpoint.Method)
	// Focus on creation and update endpoints
	if upperMethod != "POST" && upperMethod != "PUT" && upperMethod != "PATCH" {
		return
	}

	ids := ExtractResourceIDs(respBody)
	if len(ids) == 0 {
		return
	}

	fp, err := ExtractFingerprint(respBody)
	if err != nil || fp.IsErrorStructure {
		return
	}

	pathPrefix := getBasePathPrefix(endpoint.Path)

	h.mu.Lock()
	defer h.mu.Unlock()

	for _, id := range ids {
		dedupKey := fmt.Sprintf("%s:%s", pathPrefix, id)
		if h.seenIDs[dedupKey] {
			continue
		}
		h.seenIDs[dedupKey] = true

		h.resources = append(h.resources, HarvestedResource{
			ID:                  id,
			PathPrefix:          pathPrefix,
			EndpointPath:        endpoint.Path,
			Method:              endpoint.Method,
			CreatorIdentity:     creatorIdentity,
			BaselineBody:        respBody,
			BaselineFingerprint: fp,
			CreatedAt:           time.Now(),
		})
	}
}

// GetHarvestedResources returns all recorded stateful resources.
func (h *ChainHarvester) GetHarvestedResources() []HarvestedResource {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]HarvestedResource, len(h.resources))
	copy(out, h.resources)
	return out
}

// BuildCrossIdentityCandidates pairs harvested resources with dependent endpoints to probe cross-identity access.
func (h *ChainHarvester) BuildCrossIdentityCandidates(
	endpoints []swagger.EndpointConfig,
	identities []string,
) []ProbeCandidate {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var candidates []ProbeCandidate

	// Probe under alternate identities plus anonymous
	probeIdentities := make([]string, 0, len(identities)+1)
	for _, id := range identities {
		probeIdentities = append(probeIdentities, id)
	}
	probeIdentities = append(probeIdentities, "Anonymous")

	for _, res := range h.resources {
		for _, ep := range endpoints {
			paramName, ok := matchEndpointToResource(ep.Path, res.PathPrefix)
			if !ok {
				continue
			}

			resolved := substitutePathParam(ep.Path, paramName, res.ID)

			for _, probeId := range probeIdentities {
				if probeId == res.CreatorIdentity && res.CreatorIdentity != "" {
					// Skip probing under the creator's own identity
					continue
				}

				candidates = append(candidates, ProbeCandidate{
					TargetEndpoint:      ep,
					ResolvedPath:        resolved,
					HarvestedID:         res.ID,
					CreatorIdentity:     res.CreatorIdentity,
					ProbeIdentity:       probeId,
					BaselineFingerprint: res.BaselineFingerprint,
				})
			}
		}
	}

	return candidates
}

var idKeyRegex = regexp.MustCompile(`(?i)^(id|uuid|_id|item_id|entity_id|[a-z0-9_]+_id|[a-z0-9_]+id)$`)
var uuidRegex = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// ExtractResourceIDs searches a JSON payload for potential entity IDs.
func ExtractResourceIDs(body []byte) []string {
	var parsed any
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	if err := dec.Decode(&parsed); err != nil {
		return nil
	}

	var results []string
	seen := make(map[string]bool)

	var walk func(v any)
	walk = func(v any) {
		switch node := v.(type) {
		case map[string]any:
			for k, child := range node {
				if idKeyRegex.MatchString(k) {
					strVal := formatIDValue(child)
					if strVal != "" && !seen[strVal] {
						seen[strVal] = true
						results = append(results, strVal)
					}
				}
				walk(child)
			}
		case []any:
			for _, item := range node {
				walk(item)
			}
		}
	}

	walk(parsed)
	return results
}

func formatIDValue(v any) string {
	switch val := v.(type) {
	case string:
		trimmed := strings.TrimSpace(val)
		if len(trimmed) > 0 && len(trimmed) <= 128 {
			return trimmed
		}
	case json.Number:
		return val.String()
	case float64:
		if val == float64(int64(val)) {
			return fmt.Sprintf("%d", int64(val))
		}
		return fmt.Sprintf("%f", val)
	case int, int64:
		return fmt.Sprintf("%d", val)
	}
	return ""
}

func getBasePathPrefix(path string) string {
	parsed, err := url.Parse(path)
	if err == nil && parsed.Path != "" {
		path = parsed.Path
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	var prefixParts []string
	for _, p := range parts {
		if strings.HasPrefix(p, "{") && strings.HasSuffix(p, "}") {
			break
		}
		prefixParts = append(prefixParts, p)
	}
	return "/" + strings.Join(prefixParts, "/")
}

func matchEndpointToResource(epPath, resourcePrefix string) (string, bool) {
	cleanEp := strings.Trim(epPath, "/")
	cleanPrefix := strings.Trim(resourcePrefix, "/")

	if !strings.HasPrefix(cleanEp, cleanPrefix) {
		return "", false
	}

	remainder := strings.TrimPrefix(cleanEp, cleanPrefix)
	remainder = strings.Trim(remainder, "/")

	parts := strings.Split(remainder, "/")
	if len(parts) > 0 && strings.HasPrefix(parts[0], "{") && strings.HasSuffix(parts[0], "}") {
		param := strings.TrimSuffix(strings.TrimPrefix(parts[0], "{"), "}")
		return param, true
	}

	return "", false
}

func substitutePathParam(path, paramName, value string) string {
	target := "{" + paramName + "}"
	return strings.ReplaceAll(path, target, value)
}
