// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package bola

import (
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
		"trace-abc":   true,
		"1001":        true,
		"item-1":      true,
		"u-1234":      true,
		"9876543210":  true,
		"555":         true,
		"item-2":      true,
		"sub-99":      true,
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
