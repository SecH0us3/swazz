// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/swagger"
)

func TestHarvestIDs_DeepJSONAndArrays(t *testing.T) {
	data := map[string]any{
		"meta": map[string]any{
			"trace_id": "trace-abc",
			"orgId":    1001,
		},
		"results": []any{
			map[string]any{
				"id":        "item-1",
				"uuid":      "u-1234",
				"accountID": int64(9876543210),
				"price":     49.99,
				"owner_id":  float64(555),
			},
			map[string]any{
				"id":   "item-2",
				"uuid": "", // empty string should be skipped
				"sub_items": []any{
					map[string]any{
						"sub_id": "sub-99",
					},
				},
			},
		},
	}

	harvested := make(map[string]bool)
	harvestIDs(data, harvested)

	expected := map[string]bool{
		"trace-abc":  true,
		"1001":       true,
		"item-1":     true,
		"u-1234":     true,
		"9876543210": true,
		"555":        true,
		"item-2":     true,
		"sub-99":     true,
	}

	assert.Equal(t, expected, harvested)
}

func TestExtractParamsFromPath(t *testing.T) {
	tests := []struct {
		name         string
		originalPath string
		resolvedPath string
		expected     map[string]string
	}{
		{
			name:         "single path param",
			originalPath: "/api/v1/users/{id}",
			resolvedPath: "/api/v1/users/42",
			expected:     map[string]string{"id": "42"},
		},
		{
			name:         "multiple path params",
			originalPath: "/api/orgs/{org_id}/teams/{team_uuid}/members/{memberId}",
			resolvedPath: "/api/orgs/org-1/teams/t-99/members/m-7",
			expected: map[string]string{
				"org_id":    "org-1",
				"team_uuid": "t-99",
				"memberId":  "m-7",
			},
		},
		{
			name:         "no params",
			originalPath: "/api/v1/health",
			resolvedPath: "/api/v1/health",
			expected:     map[string]string{},
		},
		{
			name:         "mismatched length",
			originalPath: "/api/users/{id}",
			resolvedPath: "/api/users/42/extra",
			expected:     map[string]string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractParamsFromPath(tt.originalPath, tt.resolvedPath)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestExtractJSONPathExtended(t *testing.T) {
	data := map[string]any{
		"data": map[string]any{
			"users": []any{
				map[string]any{
					"id":   "u1",
					"name": "Alice",
				},
				map[string]any{
					"id":   "u2",
					"name": "Bob",
				},
			},
		},
		"count": 2,
	}

	assert.Equal(t, "u1", extractJSONPathExtended(data, "$.data.users[0].id"))
	assert.Equal(t, "Bob", extractJSONPathExtended(data, "data.users[1].name"))
	assert.Equal(t, 2, extractJSONPathExtended(data, "count"))
	assert.Equal(t, data, extractJSONPathExtended(data, "$"))
	assert.Equal(t, data, extractJSONPathExtended(data, ""))
	assert.Nil(t, extractJSONPathExtended(data, "data.users[5].id"))
	assert.Nil(t, extractJSONPathExtended(data, "data.nonexistent"))
	assert.Nil(t, extractJSONPathExtended(nil, "data.users[0].id"))
}

func TestResponseBodyToBytes(t *testing.T) {
	assert.Nil(t, responseBodyToBytes(nil))
	assert.Equal(t, []byte("raw string"), responseBodyToBytes("raw string"))
	assert.Equal(t, []byte("raw bytes"), responseBodyToBytes([]byte("raw bytes")))

	mapData := map[string]any{"key": "value"}
	expected, _ := responseBodyToBytes(mapData), []byte(`{"key":"value"}`)
	assert.JSONEq(t, string(expected), string(responseBodyToBytes(mapData)))
}

func TestHarvester_FullLifecycle(t *testing.T) {
	cfg := &swagger.Config{
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/v1/organizations/{orgId}/users",
				Method: "GET",
				ExtractVariables: map[string]string{
					"items[0].id": "first_user_id",
				},
			},
			{
				Path:   "/api/v1/projects",
				Method: "GET",
			},
		},
	}
	r := NewMock(cfg, nil)
	d := NewDetector(r)

	// 1. Non-2xx response should be ignored
	d.HarvestFromResponse("/api/v1/organizations/{orgId}/users", "GET", 403, map[string]any{"id": "ignored"})
	assert.Empty(t, d.collectAllHarvestedIDs())

	// 2. Successful response with heuristic IDs and explicit variables
	resp1 := map[string]any{
		"items": []any{
			map[string]any{"id": "usr-001", "name": "User 1"},
			map[string]any{"id": "usr-002", "name": "User 2"},
		},
	}
	d.HarvestFromResponse("/api/v1/organizations/{orgId}/users", "GET", 200, resp1)

	assert.Equal(t, "usr-001", r.config.Variables["first_user_id"])

	// 3. Second endpoint harvest
	resp2 := map[string]any{
		"projectId": "proj-999",
	}
	d.HarvestFromResponse("/api/v1/projects", "GET", 200, resp2)

	allIDs := d.collectAllHarvestedIDs()
	require.ElementsMatch(t, []string{"usr-001", "usr-002", "proj-999"}, allIDs)

	// Check idSources
	assert.Equal(t, "GET /api/v1/organizations/{orgId}/users", d.idSourceFor("usr-001"))
	assert.Equal(t, "GET /api/v1/projects", d.idSourceFor("proj-999"))
}

// A harvested ID comes from the target. It is kept unless it is a dot segment, too long or not
// text; escaping where it lands in a path stops it changing the path, query or fragment.
func TestIsReplayableID(t *testing.T) {
	for _, id := range []string{"42", "usr-001", "12.5", "alice@corp.com", "urn:acct:123", "a+b/c==", "../../admin?x=1#"} {
		assert.True(t, isReplayableID(id), id)
	}
	for _, id := range []string{"", ".", "..", "a\nb", "a\x00b", "\xff", strings.Repeat("a", maxHarvestedIDLen+1)} {
		assert.False(t, isReplayableID(id), id)
	}
}

func TestHarvestFromResponse_DropsUnsafeAndCaps(t *testing.T) {
	cfg := &swagger.Config{Endpoints: []swagger.EndpointConfig{{Path: "/items", Method: "GET"}}}
	d := NewDetector(NewMock(cfg, nil))

	d.HarvestFromResponse("/items", "GET", 200, map[string]any{"id": "..", "ownerId": "ok-1"})
	assert.Equal(t, []string{"ok-1"}, d.collectAllHarvestedIDs())

	for i := range maxHarvestedIDsPerPrefix + 50 {
		d.HarvestFromResponse("/items", "GET", 200, map[string]any{"id": fmt.Sprintf("id-%d", i)})
	}
	ids := d.collectAllHarvestedIDs()
	assert.Len(t, ids, maxHarvestedIDsPerPrefix)
	assert.Equal(t, "ok-1", ids[0], "IDs already kept stay; later ones past the cap are ignored")
}

// The endpoint's own resource IDs come first, so IDs of other resources never crowd them out.
func TestHarvestedIDsFor_OwnPrefixFirst(t *testing.T) {
	d := &Detector{}
	d.harvestedIDs.Store("/a", []string{"a1", "shared"})
	d.harvestedIDs.Store("/orders", []string{"o1", "o2", "shared"})
	d.harvestedIDs.Store("/z", []string{"z1"})

	assert.Equal(t, []string{"o1", "o2", "shared", "a1", "z1"}, d.harvestedIDsFor("/orders", 0))
	assert.Equal(t, []string{"o1", "o2"}, d.harvestedIDsFor("/orders", 2))
	assert.Equal(t, []string{"a1", "shared", "o1", "o2", "z1"}, d.harvestedIDsFor("/missing", 0))
}

func TestAppendUniqueCapped(t *testing.T) {
	existing := []string{"a", "b"}
	merged, added := appendUniqueCapped(existing, []string{"b", "c", "c", "d", "e"}, 4)
	assert.Equal(t, []string{"a", "b", "c", "d"}, merged)
	assert.Equal(t, []string{"c", "d"}, added)
	assert.Equal(t, []string{"a", "b"}, existing, "existing is not modified")

	merged, added = appendUniqueCapped(merged, []string{"z"}, 4)
	assert.Len(t, merged, 4)
	assert.Empty(t, added, "nothing is added past the cap")
}

// A value the response only echoes from the request is the fuzzer's own, not an ID.
func TestHarvestFromResponse_SkipsEchoedValues(t *testing.T) {
	cfg := &swagger.Config{Endpoints: []swagger.EndpointConfig{{Path: "/items", Method: "POST"}}}
	d := NewDetector(NewMock(cfg, nil))
	sentBody := map[string]any{"ownerId": "xK9-random", "tags": []any{"t"}}
	sentQuery := map[string]any{"categoryId": float64(7)}
	d.HarvestFromResponse("/items", "POST", 201,
		map[string]any{"id": "real-1", "ownerId": "xK9-random", "categoryId": float64(7)}, sentBody, sentQuery)
	assert.Equal(t, []string{"real-1"}, d.collectAllHarvestedIDs())

	// A real ID equal to a value sent under another key is kept: ?page=1 does not hide order 1.
	d = NewDetector(NewMock(&swagger.Config{Endpoints: []swagger.EndpointConfig{{Path: "/orders", Method: "GET"}}}, nil))
	d.HarvestFromResponse("/orders", "GET", 200,
		[]any{map[string]any{"id": float64(1)}, map[string]any{"id": float64(10)}}, nil, map[string]any{"page": "1", "limit": "10"})
	assert.ElementsMatch(t, []string{"1", "10"}, d.collectAllHarvestedIDs())
}

// collectAllHarvestedIDs returns every harvested ID, the endpoint-independent view tests check.
func (d *Detector) collectAllHarvestedIDs() []string { return d.harvestedIDsFor("", 0) }

// A response to a payload the target may echo still feeds explicit variables, but its ID-like
// fields are not harvested: they can hold the payload, and junk would take the capped slots.
func TestExtractVariablesFromResponse_HarvestsNoIDs(t *testing.T) {
	cfg := &swagger.Config{Endpoints: []swagger.EndpointConfig{{
		Path: "/orders", Method: "POST", ExtractVariables: map[string]string{"token": "TOKEN"},
	}}}
	r := NewMock(cfg, nil)
	d := NewDetector(r)
	d.ExtractVariablesFromResponse("/orders", "POST", 201, map[string]any{"token": "t", "productId": "' OR 1=1--"})
	assert.Equal(t, "t", r.config.Variables["TOKEN"])
	assert.Empty(t, d.collectAllHarvestedIDs())
}
