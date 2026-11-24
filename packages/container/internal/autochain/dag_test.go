// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package autochain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/swagger"
)

func TestBuildPlan_CRUDSubresourceAndDeleteWave(t *testing.T) {
	endpoints := []swagger.EndpointConfig{
		{
			Path:       "/api/v1/orgs/{orgId}",
			Method:     "DELETE",
			PathParams: map[string]*swagger.SchemaProperty{"orgId": {Type: "string"}},
		},
		{
			Path:       "/api/v1/orgs/{orgId}/projects/{projectId}",
			Method:     "DELETE",
			PathParams: map[string]*swagger.SchemaProperty{"orgId": {Type: "string"}, "projectId": {Type: "integer"}},
		},
		{
			Path:       "/api/v1/orgs/{orgId}/projects/{projectId}",
			Method:     "PATCH",
			PathParams: map[string]*swagger.SchemaProperty{"orgId": {Type: "string"}, "projectId": {Type: "integer"}},
			Schema:     swagger.SchemaProperty{Type: "object", Properties: map[string]*swagger.SchemaProperty{"status": {Type: "string"}}},
		},
		{
			Path:           "/api/v1/orgs/{orgId}/projects",
			Method:         "POST",
			PathParams:     map[string]*swagger.SchemaProperty{"orgId": {Type: "string"}},
			Schema:         swagger.SchemaProperty{Type: "object", Properties: map[string]*swagger.SchemaProperty{"name": {Type: "string"}}},
			ResponseSchema: &swagger.SchemaProperty{Type: "object", Properties: map[string]*swagger.SchemaProperty{"id": {Type: "integer"}, "status": {Type: "string"}}},
		},
		{
			Path:           "/api/v1/orgs",
			Method:         "POST",
			Schema:         swagger.SchemaProperty{Type: "object", Properties: map[string]*swagger.SchemaProperty{"name": {Type: "string"}}},
			ResponseSchema: &swagger.SchemaProperty{Type: "object", Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}, "invite_code": {Type: "string"}}},
		},
		{
			Path:   "/api/v1/invites/redeem",
			Method: "POST",
			Schema: swagger.SchemaProperty{Type: "object", Properties: map[string]*swagger.SchemaProperty{"invite_code": {Type: "string"}, "status": {Type: "string"}}},
		},
	}

	plan := BuildPlan(endpoints, nil, "https://api.example.com")
	require.Len(t, plan.Ordered, 6)
	require.GreaterOrEqual(t, len(plan.Waves), 4)
	assert.Equal(t, len(plan.Waves)-1, plan.DeleteWave)

	idxOf := func(method, path string) int {
		for i, ep := range plan.Ordered {
			if ep.Method == method && ep.Path == path {
				return i
			}
		}
		t.Fatalf("missing %s %s", method, path)
		return -1
	}

	postOrgs := idxOf("POST", "/api/v1/orgs")
	postProjects := idxOf("POST", "/api/v1/orgs/{orgId}/projects")
	patchProject := idxOf("PATCH", "/api/v1/orgs/{orgId}/projects/{projectId}")
	redeemInvite := idxOf("POST", "/api/v1/invites/redeem")
	delProject := idxOf("DELETE", "/api/v1/orgs/{orgId}/projects/{projectId}")
	delOrg := idxOf("DELETE", "/api/v1/orgs/{orgId}")

	assert.Less(t, postOrgs, postProjects)
	assert.Less(t, postProjects, patchProject)
	assert.Less(t, postOrgs, redeemInvite)
	// Child DELETE must run before parent DELETE in the teardown wave.
	assert.Less(t, patchProject, delProject)
	assert.Less(t, delProject, delOrg)

	// Denylist check: "status" on PATCH/redeem must NOT be bound from ResponseSchema.status!
	for _, b := range plan.Bindings[redeemInvite] {
		assert.NotEqual(t, []string{"status"}, b.ParamPath, "denylisted field 'status' must not be bound")
	}
	hasInviteBinding := false
	for _, b := range plan.Bindings[redeemInvite] {
		if len(b.ParamPath) == 1 && b.ParamPath[0] == "invite_code" {
			hasInviteBinding = true
			assert.Equal(t, postOrgs, b.PrimaryProd)
		}
	}
	assert.True(t, hasInviteBinding, "expected invite_code body field to bind to POST /api/v1/orgs")
}

func TestBuildPlan_OpenAPILinksManualPrecedenceCycleAndNonHTTP(t *testing.T) {
	endpoints := []swagger.EndpointConfig{
		{Path: "mcp://tool/delete_item", Method: "CALL"},
		{
			Path:        "/v1/sessions/consume",
			Method:      "POST",
			OperationID: "consumeSession",
			HeaderParams: map[string]*swagger.SchemaProperty{
				"X-Custom": {Type: "string"},
			},
			Schema: swagger.SchemaProperty{
				Type: "object",
				Properties: map[string]*swagger.SchemaProperty{
					"sessionToken": {Type: "string"},
				},
			},
			Example: map[string]any{"manual_var": "{{tok}}"},
		},
		{
			Path:        "/v1/sessions",
			Method:      "POST",
			OperationID: "createSession",
			Links: []swagger.ResponseLink{
				{
					Name:        "Consume",
					OperationID: "consumeSession",
					Parameters:  map[string]string{"sessionToken": "$response.body#/data/token"},
				},
			},
		},
		{Path: "/v1/auth-seed", Method: "POST"},
		// Mutual cycle: /v1/a/{bId} <-> /v1/b/{aId}
		{Path: "/v1/a/{bId}", Method: "GET", PathParams: map[string]*swagger.SchemaProperty{"bId": {Type: "string"}}},
		{Path: "/v1/b/{aId}", Method: "POST", PathParams: map[string]*swagger.SchemaProperty{"aId": {Type: "string"}}},
	}

	rules := []swagger.ChainingRule{
		{SourceEndpoint: "/v1/auth-seed", ExtractType: "json", ExtractPath: "tok", VariableName: "tok"},
	}

	plan := BuildPlan(endpoints, rules, "https://api.example.com")
	require.Len(t, plan.Ordered, 6)

	// MCP endpoint stays in Wave 0 untouched and NOT in DeleteWave.
	assert.Equal(t, -1, plan.DeleteWave)
	assert.Contains(t, plan.Waves[0], 0)
	assert.Equal(t, "mcp://tool/delete_item", plan.Ordered[0].Path)

	idxOf := func(path string) int {
		for i, ep := range plan.Ordered {
			if ep.Path == path {
				return i
			}
		}
		return -1
	}
	assert.Less(t, idxOf("/v1/auth-seed"), idxOf("/v1/sessions/consume"))
	assert.Less(t, idxOf("/v1/sessions"), idxOf("/v1/sessions/consume"))
}

func TestIdentityPlan(t *testing.T) {
	assert.Equal(t, &Plan{
		Ordered:    []swagger.EndpointConfig{},
		Waves:      nil,
		DeleteWave: -1,
		Bindings:   [][]ParamBinding{},
		Producers:  [][]ProducerRule{},
	}, IdentityPlan(nil))

	eps := []swagger.EndpointConfig{
		{Path: "/a", Method: "GET"},
		{Path: "/b", Method: "POST"},
	}
	plan := IdentityPlan(eps)
	require.Len(t, plan.Ordered, 2)
	assert.Equal(t, [][]int{{0, 1}}, plan.Waves)
	assert.Equal(t, -1, plan.DeleteWave)
	assert.Len(t, plan.Bindings, 2)
	assert.Len(t, plan.Producers, 2)
}

func TestBuildPlan_EmptyAndNonHTTPProtocols(t *testing.T) {
	empty := BuildPlan(nil, nil, "https://api.example.com")
	assert.Equal(t, -1, empty.DeleteWave)
	assert.Empty(t, empty.Ordered)

	eps := []swagger.EndpointConfig{
		{Path: "webmcp://tool/run", Method: "POST"},
		{Path: "/svc.Greeter/Hello", Method: "GRPC"},
		{Path: "/ws/stream", Method: "WS"},
		{Path: "/items/{id}", Method: "DELETE", PathParams: map[string]*swagger.SchemaProperty{"id": {Type: "string"}}},
	}
	plan := BuildPlan(eps, nil, "wss://api.example.com")
	// With wss:// baseURL, all endpoints are treated as non-HTTP passthrough: no DeleteWave.
	assert.Equal(t, -1, plan.DeleteWave)
	assert.Len(t, plan.Waves, 1)
	assert.Equal(t, []int{0, 1, 2, 3}, plan.Waves[0])
}

func TestBuildPlan_OperationRefHeaderLinkAndDeterminism(t *testing.T) {
	eps := []swagger.EndpointConfig{
		{
			Path:   "/v1/tokens",
			Method: "POST",
			Links: []swagger.ResponseLink{
				{
					Name:         "UseToken",
					OperationRef: "#/paths/~1v1~1items~1{itemId}/get",
					Parameters: map[string]string{
						"query.cursor":   "$response.body#/next/cursor",
						"header.X-Trace": "$response.header.X-Request-Id",
						"path.itemId":    "$response.body#/itemId",
					},
				},
			},
		},
		{
			Path:         "/v1/items/{itemId}",
			Method:       "GET",
			PathParams:   map[string]*swagger.SchemaProperty{"itemId": {Type: "string"}},
			QueryParams:  map[string]*swagger.SchemaProperty{"cursor": {Type: "string"}},
			HeaderParams: map[string]*swagger.SchemaProperty{"X-Trace": {Type: "string"}},
		},
	}

	baseline := BuildPlan(eps, nil, "https://api.example.com")
	require.Len(t, baseline.Waves, 2)
	require.Len(t, baseline.Producers[0], 4)
	require.Len(t, baseline.Bindings[1], 3)

	// Verify header expression parsing, sorted link parameter ordering, and Tier 3 resource rule.
	assert.Equal(t, "$header.X-Request-Id", baseline.Producers[0][0].ResponseExpr)
	assert.Equal(t, "itemId", baseline.Producers[0][1].ResponseExpr)
	assert.Equal(t, "next.cursor", baseline.Producers[0][2].ResponseExpr)
	assert.Equal(t, "res:tokens:id", baseline.Producers[0][3].PoolKey)

	// Repeated runs must produce bit-identical plans despite Go map iteration randomization.
	for range 25 {
		got := BuildPlan(eps, nil, "https://api.example.com")
		assert.Equal(t, baseline, got)
	}
}

