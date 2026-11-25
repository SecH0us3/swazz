// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package autochain

import (
	"encoding/json"
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

func TestBuildPlan_TrueMutualCycle(t *testing.T) {
	eps := []swagger.EndpointConfig{
		{
			Path:   "/v1/as",
			Method: "POST",
			Schema: swagger.SchemaProperty{
				Type:       "object",
				Properties: map[string]*swagger.SchemaProperty{"b_id": {Type: "string"}},
			},
			ResponseSchema: &swagger.SchemaProperty{
				Type:       "object",
				Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
			},
		},
		{
			Path:   "/v1/bs",
			Method: "POST",
			Schema: swagger.SchemaProperty{
				Type:       "object",
				Properties: map[string]*swagger.SchemaProperty{"a_id": {Type: "string"}},
			},
			ResponseSchema: &swagger.SchemaProperty{
				Type:       "object",
				Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
			},
		},
	}

	plan := BuildPlan(eps, nil, "https://api.example.com")
	require.Len(t, plan.Ordered, 2)
	require.Len(t, plan.Waves, 2)
	assert.Equal(t, 2, plan.EdgeCount)
	assert.Equal(t, "/v1/as", plan.Ordered[0].Path)
	assert.Equal(t, "/v1/bs", plan.Ordered[1].Path)
}

func TestBuildPlan_ParseSpecGETQueryParamsHeuristicAndLink(t *testing.T) {
	spec := `{
		"openapi": "3.0.3",
		"info": {"title": "Test", "version": "1.0"},
		"paths": {
			"/api/users": {
				"post": {
					"operationId": "createUser",
					"requestBody": {
						"content": {
							"application/json": {
								"schema": {"type": "object", "properties": {"name": {"type": "string"}}}
							}
						}
					},
					"responses": {
						"201": {
							"description": "created",
							"content": {
								"application/json": {
									"schema": {"type": "object", "properties": {"id": {"type": "string"}, "nextCursor": {"type": "string"}}}
								}
							},
							"links": {
								"ListOrders": {
									"operationId": "listOrders",
									"parameters": {"cursor": "$response.body#/nextCursor"}
								}
							}
						}
					}
				}
			},
			"/api/orders": {
				"get": {
					"operationId": "listOrders",
					"parameters": [
						{"name": "user_id", "in": "query", "schema": {"type": "string"}},
						{"name": "cursor", "in": "query", "schema": {"type": "integer"}}
					],
					"responses": {"200": {"description": "ok"}}
				}
			}
		}
	}`

	parsed, err := swagger.ParseSpec(json.RawMessage(spec))
	require.NoError(t, err)

	plan := BuildPlan(parsed.Endpoints, nil, "https://api.example.com")
	require.Len(t, plan.Ordered, 2)
	require.Len(t, plan.Waves, 2)
	assert.Equal(t, "/api/users", plan.Ordered[0].Path)
	assert.Equal(t, "/api/orders", plan.Ordered[1].Path)

	var gotUserID, gotCursor *ParamBinding
	for i := range plan.Bindings[1] {
		b := &plan.Bindings[1][i]
		if len(b.ParamPath) == 1 && b.ParamPath[0] == "user_id" {
			gotUserID = b
		}
		if len(b.ParamPath) == 1 && b.ParamPath[0] == "cursor" {
			gotCursor = b
		}
	}
	require.NotNil(t, gotUserID, "expected heuristic FK user_id on GET query param")
	assert.Equal(t, LocQuery, gotUserID.Location)
	assert.Equal(t, "res:users:id", gotUserID.PoolKey)

	require.NotNil(t, gotCursor, "expected OpenAPI 3 Link cursor without query. prefix to bind to LocQuery")
	assert.Equal(t, LocQuery, gotCursor.Location)
	assert.Equal(t, SourceLink, gotCursor.Source)
	require.NotNil(t, gotCursor.TargetSchema)
	assert.Equal(t, "integer", gotCursor.TargetSchema.Type)
}

func TestBuildPlan_OpenAPILinkEdgeCasesAndExampleProtection(t *testing.T) {
	eps := []swagger.EndpointConfig{
		{
			Path:   "/v1/auth",
			Method: "POST",
			Links: []swagger.ResponseLink{
				{
					Name:        "LinkA",
					OperationID: "targetA",
					Parameters: map[string]string{
						"id":         "$response.body#/aId",
						"constParam": "literal",
						"reqParam":   "$request.body#/foo",
					},
				},
				{
					Name:        "LinkB",
					OperationID: "targetB",
					Parameters: map[string]string{
						"id": "$response.body#/bId",
					},
				},
				{
					Name:        "LinkMCP",
					OperationID: "mcpOp",
					Parameters: map[string]string{
						"x": "$response.body#/x",
					},
				},
			},
		},
		{Path: "/v1/targets-a", Method: "POST", OperationID: "targetA"},
		{Path: "/v1/targets-b", Method: "POST", OperationID: "targetB"},
		{Path: "mcp://tool/run", Method: "CALL", OperationID: "mcpOp"},
		{
			Path:   "/v1/users",
			Method: "POST",
			ResponseSchema: &swagger.SchemaProperty{
				Type:       "object",
				Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
			},
		},
		{
			Path:   "/v1/orders",
			Method: "POST",
			Schema: swagger.SchemaProperty{
				Type: "object",
				Properties: map[string]*swagger.SchemaProperty{
					"user_id": {Type: "string"},
					"nested": {
						Type:       "object",
						Properties: map[string]*swagger.SchemaProperty{"user_id": {Type: "string"}},
					},
				},
			},
			Example: map[string]any{
				"user_id": "{{tok}}",
				"nested":  map[string]any{"user_id": "{{tok}}"},
			},
		},
		{
			Path:        "/v1/orders",
			Method:      "GET",
			QueryParams: map[string]*swagger.SchemaProperty{"user_id": {Type: "string"}},
			Example:     map[string]any{"user_id": "{{tok}}"},
		},
	}

	rules := []swagger.ChainingRule{
		{SourceEndpoint: "/v1/auth", ExtractType: "json", ExtractPath: "tok", VariableName: "tok"},
	}

	plan := BuildPlan(eps, rules, "https://api.example.com")

	idxOf := func(method, path string) int {
		for i, ep := range plan.Ordered {
			if ep.Method == method && ep.Path == path {
				return i
			}
		}
		t.Fatalf("missing %s %s", method, path)
		return -1
	}

	authIdx := idxOf("POST", "/v1/auth")
	// Only LinkA.id and LinkB.id plus Tier 3 res:auth:id should exist; constParam, reqParam, LinkMCP must be skipped.
	var linkRules []ProducerRule
	for _, pr := range plan.Producers[authIdx] {
		if len(pr.PoolKey) >= 5 && pr.PoolKey[:5] == "link:" {
			linkRules = append(linkRules, pr)
		}
	}
	require.Len(t, linkRules, 2)
	assert.NotEqual(t, linkRules[0].PoolKey, linkRules[1].PoolKey, "expected link name to distinguish link poolKeys")

	postOrdersIdx := idxOf("POST", "/v1/orders")
	assert.Empty(t, plan.Bindings[postOrdersIdx], "Tier 1 ep.Example {{tok}} must protect body slots from Tier 3 overwrite")

	getOrdersIdx := idxOf("GET", "/v1/orders")
	assert.Empty(t, plan.Bindings[getOrdersIdx], "Tier 1 ep.Example {{tok}} must protect query slots from Tier 3 overwrite")
}

func TestBuildPlan_TrailingNonHTTPEndpointsStayAfterHTTPWavesAndPathSchemes(t *testing.T) {
	eps := []swagger.EndpointConfig{
		{
			Path:   "/api/orders/{orderId}",
			Method: "DELETE",
			PathParams: map[string]*swagger.SchemaProperty{
				"orderId": {Type: "string"},
			},
		},
		{
			Path:   "/api/orders",
			Method: "POST",
			ResponseSchema: &swagger.SchemaProperty{
				Type:       "object",
				Properties: map[string]*swagger.SchemaProperty{"id": {Type: "string"}},
			},
		},
		{
			Path:   "/api/orders/{orderId}",
			Method: "GET",
			PathParams: map[string]*swagger.SchemaProperty{
				"orderId": {Type: "string"},
			},
		},
		// Emulates init_run.go's prepareMCP appending mcp:// tools/probes after HTTP specs,
		// plus explicit grpc:// / ws:// path scheme endpoints.
		{Path: "mcp://tool/query_db", Method: "CALL"},
		{Path: "mcp://tool/__globals__", Method: "CALL"},
		{Path: "grpc://svc.Orders/Get", Method: "GET"},
		{Path: "ws://stream/orders", Method: "GET"},
	}

	plan := BuildPlan(eps, nil, "https://api.example.com")
	require.Len(t, plan.Ordered, 7)

	idxOf := func(method, path string) int {
		for i, ep := range plan.Ordered {
			if ep.Method == method && ep.Path == path {
				return i
			}
		}
		t.Fatalf("missing %s %s", method, path)
		return -1
	}

	postIdx := idxOf("POST", "/api/orders")
	getIdx := idxOf("GET", "/api/orders/{orderId}")
	delIdx := idxOf("DELETE", "/api/orders/{orderId}")
	mcpQueryIdx := idxOf("CALL", "mcp://tool/query_db")
	mcpProbeIdx := idxOf("CALL", "mcp://tool/__globals__")
	grpcIdx := idxOf("GET", "grpc://svc.Orders/Get")
	wsIdx := idxOf("GET", "ws://stream/orders")

	assert.Less(t, postIdx, getIdx)
	assert.Less(t, getIdx, delIdx)
	// Trailing non-HTTP wave must run AFTER all HTTP waves (including DELETE) in original relative order.
	assert.Less(t, delIdx, mcpQueryIdx)
	assert.Less(t, mcpQueryIdx, mcpProbeIdx)
	assert.Less(t, mcpProbeIdx, grpcIdx)
	assert.Less(t, grpcIdx, wsIdx)
	assert.Empty(t, plan.Bindings[grpcIdx], "grpc:// path endpoint must bypass HTTP heuristic bindings")
	assert.Empty(t, plan.Bindings[wsIdx], "ws:// path endpoint must bypass HTTP heuristic bindings")
}

