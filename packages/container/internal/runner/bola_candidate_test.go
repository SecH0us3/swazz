// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/swagger"
)

func TestCandidate_SubstituteIDInPath(t *testing.T) {
	tests := []struct {
		name         string
		templatePath string
		id           string
		expected     string
	}{
		{
			name:         "single id segment",
			templatePath: "/api/v1/users/{id}",
			id:           "user-42",
			expected:     "/api/v1/users/user-42",
		},
		{
			name:         "uuid segment",
			templatePath: "/api/v1/items/{uuid}",
			id:           "u-1234-abcd",
			expected:     "/api/v1/items/u-1234-abcd",
		},
		{
			name:         "suffix id segment",
			templatePath: "/api/v1/orgs/{org_id}/teams/{teamId}",
			id:           "999",
			expected:     "/api/v1/orgs/999/teams/999",
		},
		{
			name:         "non-id param is not replaced",
			templatePath: "/api/v1/users/{action}",
			id:           "42",
			expected:     "/api/v1/users/{action}",
		},
		{
			name:         "no parameters",
			templatePath: "/api/v1/health",
			id:           "42",
			expected:     "/api/v1/health",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := substituteIDInPath(tt.templatePath, tt.id)
			assert.Equal(t, tt.expected, got)
		})
	}
}

func TestCandidate_CoerceID(t *testing.T) {
	// Int64
	assert.Equal(t, int64(100), coerceID(int64(42), "100"))
	assert.Equal(t, "invalid-int", coerceID(int64(42), "invalid-int"))

	// Int
	assert.Equal(t, 200, coerceID(10, "200"))
	assert.Equal(t, "not-a-number", coerceID(10, "not-a-number"))

	// Float64
	assert.Equal(t, float64(12.34), coerceID(float64(1.0), "12.34"))
	assert.Equal(t, "not-a-float", coerceID(float64(1.0), "not-a-float"))

	// String & other types
	assert.Equal(t, "new-uuid", coerceID("old-uuid", "new-uuid"))
	assert.Equal(t, "new-val", coerceID(true, "new-val"))
}

func TestCandidate_SubstituteIDsInPayload(t *testing.T) {
	payload := map[string]any{
		"userId":  int(100),
		"uuid":    "u-old",
		"name":    "Alice",
		"balance": 150.50,
		"meta": map[string]any{
			"account_id": int64(9999),
			"tag":        "regular",
		},
		"items": []any{
			map[string]any{
				"item_id": 1,
				"label":   "box",
			},
		},
	}

	// Substitute specific paramName "userId"
	res := substituteIDsInPayload(payload, "userId", "500")
	resMap, ok := res.(map[string]any)
	require.True(t, ok)

	assert.Equal(t, 500, resMap["userId"])
	assert.Equal(t, "500", resMap["uuid"]) // isIDParam triggered
	assert.Equal(t, "Alice", resMap["name"])

	metaMap := resMap["meta"].(map[string]any)
	assert.Equal(t, int64(500), metaMap["account_id"])
	assert.Equal(t, "regular", metaMap["tag"])

	itemsArr := resMap["items"].([]any)
	item0 := itemsArr[0].(map[string]any)
	assert.Equal(t, 500, item0["item_id"])
	assert.Equal(t, "box", item0["label"])
}

func TestCandidate_IdentifyCandidates(t *testing.T) {
	r := &Runner{}
	results := []*swagger.FuzzResult{
		{Status: 200, Method: "GET", Endpoint: "/api/users"},
		{Status: 201, Method: "POST", Endpoint: "/api/users"},
		{Status: 400, Method: "PUT", Endpoint: "/api/users/{id}"},
		{Status: 404, Method: "DELETE", Endpoint: "/api/users/{id}"},
		{Status: 204, Method: "DELETE", Endpoint: "/api/items/{id}"},
	}

	candidates, hasSuccess := r.identifyCandidates(results)
	assert.Len(t, candidates, 3)
	assert.True(t, hasSuccess["GET /api/users"])
	assert.True(t, hasSuccess["POST /api/users"])
	assert.True(t, hasSuccess["DELETE /api/items/{id}"])
	assert.False(t, hasSuccess["PUT /api/users/{id}"])
	assert.False(t, hasSuccess["DELETE /api/users/{id}"])
}

func TestCandidate_ParamNameAndPathBuilding(t *testing.T) {
	epPath := swagger.EndpointConfig{Path: "/api/orgs/{orgId}"}
	assert.Equal(t, "orgId", candidateParamName(epPath, true, nil))

	epBody := swagger.EndpointConfig{Path: "/api/orgs"}
	assert.Equal(t, "account_id", candidateParamName(epBody, false, map[string]any{"account_id": "1", "desc": "none"}))
	assert.Equal(t, "", candidateParamName(epBody, false, map[string]any{"desc": "none"}))

	// Path building
	assert.Equal(t, "/api/orgs", buildCandidatePath("/api/orgs", false, nil, 0))
	assert.Equal(t, "/api/orgs/org-100", buildCandidatePath("/api/orgs/{id}", true, []string{"org-100", "org-200"}, 0))
	assert.Equal(t, "/api/orgs/org-200", buildCandidatePath("/api/orgs/{id}", true, []string{"org-100", "org-200"}, 1))
	assert.Equal(t, "/api/orgs/00000000-0000-4000-8000-000000000000", buildCandidatePath("/api/orgs/{id}", true, nil, 0))
}

func TestCandidate_BuildPayload(t *testing.T) {
	// GET method with baseBody -> queryParams
	epGET := swagger.EndpointConfig{Method: "GET"}
	baseBody := map[string]any{"user_id": 10, "filter": "active"}
	payload, qp := buildCandidatePayload(epGET, baseBody, "user_id", []string{"99"}, 0)
	assert.Nil(t, payload)
	assert.Equal(t, 99, qp["user_id"])
	assert.Equal(t, "active", qp["filter"])

	// POST method with baseBody -> body payload
	epPOST := swagger.EndpointConfig{Method: "POST"}
	payloadPOST, qpPOST := buildCandidatePayload(epPOST, baseBody, "user_id", []string{"99"}, 0)
	assert.Nil(t, qpPOST)
	bodyMap := payloadPOST.(map[string]any)
	assert.Equal(t, 99, bodyMap["user_id"])
	assert.Equal(t, "active", bodyMap["filter"])

	// Example fallback for POST
	epExamplePOST := swagger.EndpointConfig{Method: "POST", Example: map[string]any{"key": "val"}}
	pEx, qpEx := buildCandidatePayload(epExamplePOST, nil, "", nil, 0)
	assert.Nil(t, qpEx)
	assert.Equal(t, map[string]any{"key": "val"}, pEx)

	// Example fallback for GET
	epExampleGET := swagger.EndpointConfig{Method: "GET", Example: map[string]any{"key": "val"}}
	pExGET, qpExGET := buildCandidatePayload(epExampleGET, nil, "", nil, 0)
	assert.Nil(t, pExGET)
	assert.Equal(t, map[string]any{"key": "val"}, qpExGET)
}
