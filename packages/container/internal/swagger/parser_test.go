// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package swagger

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseSpec_OpenAPI3(t *testing.T) {
	specRaw := `{
		"openapi": "3.0.0",
		"info": {
			"title": "Test API",
			"version": "1.0.0"
		},
		"servers": [
			{ "url": "https://api.example.com/v1" }
		],
		"paths": {
			"/users": {
				"post": {
					"requestBody": {
						"content": {
							"application/json": {
								"schema": {
									"type": "object",
									"properties": {
										"name": { "type": "string" }
									}
								}
							}
						}
					}
				}
			},
			"/users/{id}": {
				"get": {
					"parameters": [
						{
							"name": "id",
							"in": "path",
							"required": true,
							"schema": { "type": "integer" }
						},
						{
							"name": "X-Auth",
							"in": "header",
							"schema": { "type": "string" }
						},
						{
							"name": "limit",
							"in": "query",
							"type": "integer",
							"format": "int32"
						}
					]
				}
			}
		}
	}`

	result, err := ParseSpec(json.RawMessage(specRaw), WithMaxNodes(1000), WithMaxDepth(10))
	require.NoError(t, err)
	assert.Equal(t, "https://api.example.com/v1", result.BasePath)
	assert.Len(t, result.Endpoints, 2)

	// Verify POST /users
	var postEndpoint *EndpointConfig
	var getEndpoint *EndpointConfig
	for i, ep := range result.Endpoints {
		if ep.Method == "POST" && ep.Path == "/users" {
			postEndpoint = &result.Endpoints[i]
		}
		if ep.Method == "GET" && ep.Path == "/users/{id}" {
			getEndpoint = &result.Endpoints[i]
		}
	}

	require.NotNil(t, postEndpoint)
	require.NotNil(t, getEndpoint)
	assert.Equal(t, "object", postEndpoint.Schema.Type)
	assert.Len(t, getEndpoint.PathParams, 1)
	assert.Len(t, getEndpoint.HeaderParams, 1)
	assert.NotNil(t, getEndpoint.Schema.Properties)
	assert.Equal(t, "integer", getEndpoint.Schema.Properties["limit"].Type)
}

func TestParseSpec_Swagger2(t *testing.T) {
	specRaw := `{
		"swagger": "2.0",
		"host": "api.example.com",
		"basePath": "/v2",
		"schemes": ["https"],
		"paths": {
			"/ping": {
				"get": {
					"responses": {
						"200": {
							"description": "OK"
						}
					}
				}
			},
			"/login": {
				"post": {
					"parameters": [
						{
							"name": "body",
							"in": "body",
							"schema": {
								"type": "object",
								"properties": {
									"username": { "type": "string", "example": "admin" },
									"password": { "type": "string", "default": "pass" }
								}
							},
							"example": {"username": "admin", "password": "secret"}
						}
					]
				}
			}
		}
	}`

	result, err := ParseSpec(json.RawMessage(specRaw))
	require.NoError(t, err)
	assert.Equal(t, "https://api.example.com/v2", result.BasePath)
	assert.Len(t, result.Endpoints, 2)
}

func TestParseSpec_ContentTypesAndExamples(t *testing.T) {
	specRaw := `{
		"openapi": "3.0.0",
		"paths": {
			"/upload": {
				"post": {
					"requestBody": {
						"content": {
							"multipart/form-data": {
								"schema": {
									"type": "object",
									"properties": {
										"file": { "type": "string", "format": "binary" }
									}
								},
								"examples": {
									"default": {
										"value": {"file": "sample.txt"}
									}
								}
							}
						}
					}
				}
			},
			"/form": {
				"post": {
					"requestBody": {
						"content": {
							"application/x-www-form-urlencoded": {
								"schema": {
									"type": "object",
									"properties": {
										"token": { "type": "string", "default": "tok123" }
									}
								}
							}
						}
					}
				}
			},
			"/wildcard": {
				"post": {
					"requestBody": {
						"content": {
							"*/*": {
								"schema": {
									"type": "string",
									"example": "rawtext"
								}
							}
						}
					}
				}
			}
		}
	}`

	result, err := ParseSpec(json.RawMessage(specRaw))
	require.NoError(t, err)
	assert.Len(t, result.Endpoints, 3)

	for _, ep := range result.Endpoints {
		if ep.Path == "/upload" {
			assert.Equal(t, "multipart/form-data", ep.ContentType)
		}
		if ep.Path == "/form" {
			assert.Equal(t, "application/x-www-form-urlencoded", ep.ContentType)
		}
		if ep.Path == "/wildcard" {
			assert.Equal(t, "application/json", ep.ContentType)
		}
	}
}

func TestNormalizeBasePath(t *testing.T) {
	assert.Equal(t, "https://api.example.com/default/v1", normalizeBasePath("https://api.example.com/{environment}/v1"))
	assert.Equal(t, "https://api.example.com/v1", normalizeBasePath("https://api.example.com/v1"))
	assert.Equal(t, "https://api.example.com/default/default", normalizeBasePath("https://api.example.com/{region}/{env}"))
}

func TestParseSpec_Invalid(t *testing.T) {
	_, err := ParseSpec(json.RawMessage(`{}`))
	assert.Error(t, err)

	_, err = ParseSpec(json.RawMessage(`invalid json`))
	assert.Error(t, err)
}

func TestDetermineBasePath(t *testing.T) {
	tests := []struct {
		name     string
		spec     map[string]any
		expected string
	}{
		{
			name: "OpenAPI 3.x valid server",
			spec: map[string]any{
				"openapi": "3.0.0",
				"servers": []any{
					map[string]any{
						"url": "https://api.example.com/v1",
					},
				},
			},
			expected: "https://api.example.com/v1",
		},
		{
			name: "OpenAPI 3.x no servers",
			spec: map[string]any{
				"openapi": "3.0.0",
			},
			expected: "",
		},
		{
			name: "Swagger 2.0 full",
			spec: map[string]any{
				"swagger":  "2.0",
				"schemes":  []any{"http"},
				"host":     "api.example.com",
				"basePath": "/v2",
			},
			expected: "http://api.example.com/v2",
		},
		{
			name: "Swagger 2.0 default scheme",
			spec: map[string]any{
				"swagger":  "2.0",
				"host":     "api.example.com",
				"basePath": "/v2",
			},
			expected: "https://api.example.com/v2",
		},
		{
			name: "Swagger 2.0 no host",
			spec: map[string]any{
				"swagger":  "2.0",
				"basePath": "/v2",
			},
			expected: "/v2",
		},
		{
			name: "Unknown spec",
			spec: map[string]any{
				"unknown": "1.0",
			},
			expected: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := determineBasePath(tt.spec)
			assert.Equal(t, tt.expected, actual)
		})
	}
}

func TestParseRawSpec(t *testing.T) {
	t.Run("Valid YAML OpenAPI Spec", func(t *testing.T) {
		yamlSpec := `
openapi: 3.0.0
info:
  title: Test YAML API
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
paths:
  /ping:
    get:
      summary: Ping the server
`
		result, err := ParseRawSpec([]byte(yamlSpec))
		require.NoError(t, err)
		assert.Equal(t, "https://api.example.com/v1", result.BasePath)
		assert.Len(t, result.Endpoints, 1)
		assert.Equal(t, "GET", result.Endpoints[0].Method)
	})

	t.Run("Valid JSON OpenAPI Spec", func(t *testing.T) {
		jsonSpec := `
{
  "openapi": "3.0.0",
  "info": {
    "title": "Test JSON API",
    "version": "1.0.0"
  },
  "servers": [
    {"url": "https://api.example.com/v2"}
  ],
  "paths": {
    "/ping": {
      "get": {
        "summary": "Ping the server"
      }
    }
  }
}
`
		result, err := ParseRawSpec([]byte(jsonSpec))
		require.NoError(t, err)
		assert.Equal(t, "https://api.example.com/v2", result.BasePath)
		assert.Len(t, result.Endpoints, 1)
	})

	t.Run("Invalid YAML Spec", func(t *testing.T) {
		invalidYaml := `
foo: bar: baz
`
		_, err := ParseRawSpec([]byte(invalidYaml))
		assert.Error(t, err)
	})

	t.Run("Invalid JSON Spec", func(t *testing.T) {
		invalidJson := `
{ "invalid": "json",
`
		_, err := ParseRawSpec([]byte(invalidJson))
		assert.Error(t, err)
	})
}

func TestExtractParams_DirectHelpers(t *testing.T) {
	// 1. extractPathParams
	rawParams := []any{
		map[string]any{"in": "query", "name": "q"}, // not path
		map[string]any{"in": "path", "name": "id", "type": "integer", "format": "int64"},
		map[string]any{"in": "path", "name": "slug", "schema": map[string]any{"type": "string", "format": "slug"}},
		map[string]any{"in": "path", "name": ""}, // empty name
		"invalid non-map",
	}
	pathParams := extractPathParams(rawParams)
	assert.Len(t, pathParams, 2)
	assert.Equal(t, "integer", pathParams["id"].Type)
	assert.Equal(t, "int64", pathParams["id"].Format)
	assert.Equal(t, "string", pathParams["slug"].Type)
	assert.Equal(t, "slug", pathParams["slug"].Format)

	// 2. extractHeaderParams
	rawHeaderParams := []any{
		map[string]any{"in": "path", "name": "id"}, // not header
		map[string]any{"in": "header", "name": "X-Trace", "type": "string"},
		map[string]any{"in": "header", "name": "X-Count", "schema": map[string]any{"type": "integer"}},
		map[string]any{"in": "header", "name": ""},
		123,
	}
	headerParams := extractHeaderParams(rawHeaderParams, nil, "", 100, 5)
	assert.Len(t, headerParams, 2)
	assert.Equal(t, "string", headerParams["X-Trace"].Type)
	assert.Equal(t, "integer", headerParams["X-Count"].Type)

	// 3. getStringField
	m := map[string]any{"str": "value", "num": 123}
	assert.Equal(t, "value", getStringField(m, "str"))
	assert.Equal(t, "", getStringField(m, "num"))
	assert.Equal(t, "", getStringField(m, "nonexistent"))
}

func TestParseSpec_DeterministicOrderAndResponseMetadata(t *testing.T) {
	raw := []byte(`{
		"openapi": "3.0.3",
		"paths": {
			"/z-items/{itemId}": {
				"get": {
					"operationId": "getItem",
					"parameters": [{"name": "itemId", "in": "path", "required": true, "schema": {"type": "integer"}}],
					"responses": {
						"200": {
							"content": {
								"application/json": {
									"schema": {
										"type": "object",
										"properties": {"id": {"type": "integer"}, "slug": {"type": "string"}}
									}
								}
							}
						}
					}
				}
			},
			"/a-items": {
				"post": {
					"operationId": "createItem",
					"requestBody": {
						"content": {"application/json": {"schema": {"type": "object", "properties": {"title": {"type": "string"}}}}}
					},
					"responses": {
						"201": {
							"content": {
								"application/json": {
									"schema": {
										"type": "object",
										"properties": {"id": {"type": "integer"}, "upload_token": {"type": "string"}}
									}
								}
							},
							"links": {
								"GetCreatedItem": {
									"operationId": "getItem",
									"parameters": {"itemId": "$response.body#/id"}
								}
							}
						}
					}
				}
			}
		}
	}`)

	for range 20 {
		res, err := ParseSpec(raw)
		if err != nil {
			t.Fatalf("ParseSpec failed: %v", err)
		}
		if len(res.Endpoints) != 2 {
			t.Fatalf("expected 2 endpoints, got %d", len(res.Endpoints))
		}
		if res.Endpoints[0].Path != "/a-items" || res.Endpoints[1].Path != "/z-items/{itemId}" {
			t.Fatalf("expected deterministic lexicographic path order, got %s then %s", res.Endpoints[0].Path, res.Endpoints[1].Path)
		}
		createEP := res.Endpoints[0]
		if createEP.OperationID != "createItem" {
			t.Fatalf("expected OperationID createItem, got %q", createEP.OperationID)
		}
		if createEP.ResponseSchema == nil || createEP.ResponseSchema.Properties["upload_token"] == nil {
			t.Fatalf("expected 201 ResponseSchema with upload_token, got %+v", createEP.ResponseSchema)
		}
		if len(createEP.Links) != 1 || createEP.Links[0].OperationID != "getItem" || createEP.Links[0].Parameters["itemId"] != "$response.body#/id" {
			t.Fatalf("expected OpenAPI link to getItem, got %+v", createEP.Links)
		}
		if res.Endpoints[1].ResponseSchema != nil {
			t.Fatalf("expected GET endpoint to skip ResponseSchema extraction to avoid config bloat, got %+v", res.Endpoints[1].ResponseSchema)
		}
	}
}

func TestDerefMap_RefResolutionAndMissingTarget(t *testing.T) {
	spec := map[string]any{
		"components": map[string]any{
			"responses": map[string]any{
				"Created": map[string]any{"description": "created"},
			},
		},
	}

	resolved := derefMap(map[string]any{"$ref": "#/components/responses/Created"}, spec)
	if resolved == nil || resolved["description"] != "created" {
		t.Fatalf("expected resolved component response map, got %+v", resolved)
	}

	missing := derefMap(map[string]any{"$ref": "#/components/responses/DoesNotExist"}, spec)
	if missing != nil {
		t.Fatalf("expected nil for missing $#ref target, got %+v", missing)
	}
}

func TestParseSwagger2_FormDataFileUpload(t *testing.T) {
	spec := `{
		"swagger": "2.0",
		"info": {"title": "Upload API", "version": "1.0"},
		"paths": {
			"/upload": {
				"post": {
					"consumes": ["multipart/form-data"],
					"parameters": [
						{"name": "avatar", "in": "formData", "type": "file", "required": true},
						{"name": "caption", "in": "formData", "type": "string"}
					],
					"responses": {"200": {"description": "ok"}}
				}
			}
		}
	}`
	res, err := ParseRawSpec([]byte(spec))
	require.NoError(t, err)
	require.Len(t, res.Endpoints, 1)

	ep := res.Endpoints[0]
	assert.Equal(t, "multipart/form-data", ep.ContentType)
	assert.Nil(t, ep.QueryParams, "formData parameters must not leak into QueryParams")
	require.NotNil(t, ep.Schema)
	assert.Equal(t, "object", ep.Schema.Type)
	require.Contains(t, ep.Schema.Properties, "avatar")
	assert.Equal(t, "string", ep.Schema.Properties["avatar"].Type)
	assert.Equal(t, "binary", ep.Schema.Properties["avatar"].Format)
	assert.Contains(t, ep.Schema.Required, "avatar")
	require.Contains(t, ep.Schema.Properties, "caption")
	assert.Equal(t, "string", ep.Schema.Properties["caption"].Type)

	t.Run("formData without file defaults to x-www-form-urlencoded", func(t *testing.T) {
		urlEncSpec := `{
			"swagger": "2.0",
			"info": {"title": "Form API", "version": "1.0"},
			"paths": {
				"/submit": {
					"post": {
						"parameters": [
							{"name": "user", "in": "formData", "type": "string", "required": true}
						],
						"responses": {"200": {"description": "ok"}}
					}
				}
			}
		}`
		r, err := ParseRawSpec([]byte(urlEncSpec))
		require.NoError(t, err)
		require.Len(t, r.Endpoints, 1)
		assert.Equal(t, "application/x-www-form-urlencoded", r.Endpoints[0].ContentType)
	})

	t.Run("formData file without consumes and top-level consumes multipart", func(t *testing.T) {
		noConsumesSpec := `{
			"swagger": "2.0",
			"info": {"title": "File API", "version": "1.0"},
			"consumes": ["multipart/form-data"],
			"paths": {
				"/up1": {
					"post": {
						"parameters": [{"name": "doc", "in": "formData", "type": "file"}],
						"responses": {"200": {"description": "ok"}}
					}
				},
				"/up2": {
					"post": {
						"parameters": [{"name": "meta", "in": "formData", "type": "string"}],
						"responses": {"200": {"description": "ok"}}
					}
				}
			}
		}`
		r, err := ParseRawSpec([]byte(noConsumesSpec))
		require.NoError(t, err)
		require.Len(t, r.Endpoints, 2)
		assert.Equal(t, "multipart/form-data", r.Endpoints[0].ContentType)
		assert.Equal(t, "multipart/form-data", r.Endpoints[1].ContentType)
	})
}
