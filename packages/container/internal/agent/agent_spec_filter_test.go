// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package agent

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"swazz-engine/internal/swagger"
)

func TestAgentSpecFilter_FilterSensitiveData(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "clean spec",
			input:    `{"openapi": "3.0.0", "info": {"title": "Public API"}}`,
			expected: `{"openapi": "3.0.0", "info": {"title": "Public API"}}`,
		},
		{
			name:     "contains password and secret",
			input:    `{"user": "admin", "password": "supersecret", "secret_key": "123"}`,
			expected: `{"user": "admin", "[FILTERED]": "super[FILTERED]", "[FILTERED]_key": "123"}`,
		},
		{
			name:     "contains tokens and keys",
			input:    `{"token": "xyz", "api_key": "abc", "access_key": "def", "jwt": "ghi", "bearer": "jkl", "aws": "mno", "private_key": "pqr"}`,
			expected: `{"[FILTERED]": "xyz", "[FILTERED]": "abc", "[FILTERED]": "def", "[FILTERED]": "ghi", "[FILTERED]": "jkl", "[FILTERED]": "mno", "[FILTERED]": "pqr"}`,
		},
		{
			name:     "empty string",
			input:    "",
			expected: "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			actual := filterSensitiveData(tc.input)
			assert.Equal(t, tc.expected, actual)
		})
	}
}

func TestAgentSpecFilter_PruneSchema(t *testing.T) {
	t.Run("nil schema safety", func(t *testing.T) {
		assert.NotPanics(t, func() {
			pruneSchema(nil, 0, 3)
		})
	})

	t.Run("shallow schema preserved", func(t *testing.T) {
		schema := &swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"name": {Type: "string"},
				"age":  {Type: "integer"},
			},
		}

		pruneSchema(schema, 0, 3)
		assert.NotNil(t, schema.Properties)
		assert.Equal(t, "string", schema.Properties["name"].Type)
		assert.Equal(t, "integer", schema.Properties["age"].Type)
	})

	t.Run("deeply nested schema pruned at maxDepth", func(t *testing.T) {
		// Depth 0: Root object
		// Depth 1: Level 1 object
		// Depth 2: Level 2 object
		// Depth 3: Level 3 object (properties will be pruned)
		schema := &swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"level1": {
					Type: "object",
					Properties: map[string]*swagger.SchemaProperty{
						"level2": {
							Type: "object",
							Properties: map[string]*swagger.SchemaProperty{
								"level3": {
									Type: "object",
									Properties: map[string]*swagger.SchemaProperty{
										"level4": {Type: "string"},
									},
								},
							},
						},
					},
				},
			},
		}

		pruneSchema(schema, 0, 2)
		// At maxDepth=2:
		// root (0) -> level1 (1) -> level2 (2 - truncated)
		assert.NotNil(t, schema.Properties["level1"])
		assert.Nil(t, schema.Properties["level1"].Properties["level2"].Properties)
	})

	t.Run("nested array items pruned at maxDepth", func(t *testing.T) {
		schema := &swagger.SchemaProperty{
			Type: "array",
			Items: &swagger.SchemaProperty{
				Type: "array",
				Items: &swagger.SchemaProperty{
					Type: "object",
					Properties: map[string]*swagger.SchemaProperty{
						"id": {Type: "integer"},
					},
					Items: &swagger.SchemaProperty{
						Type: "string",
					},
				},
			},
		}

		pruneSchema(schema, 0, 2)
		// Depth 0 (array) -> Depth 1 (array) -> Depth 2 (object truncated)
		assert.NotNil(t, schema.Items)
		assert.NotNil(t, schema.Items.Items)
		assert.Nil(t, schema.Items.Items.Properties)
		assert.Nil(t, schema.Items.Items.Items)
	})

	t.Run("endpoint parameters pruning", func(t *testing.T) {
		ep := swagger.EndpointConfig{
			Path:   "/users/{id}",
			Method: "GET",
			PathParams: map[string]*swagger.SchemaProperty{
				"id": {
					Type: "object",
					Properties: map[string]*swagger.SchemaProperty{
						"nested": {
							Type: "object",
							Properties: map[string]*swagger.SchemaProperty{
								"deep": {Type: "string"},
							},
						},
					},
				},
			},
			QueryParams: map[string]*swagger.SchemaProperty{
				"filter": {
					Type: "object",
					Properties: map[string]*swagger.SchemaProperty{
						"nested": {
							Type: "object",
							Properties: map[string]*swagger.SchemaProperty{
								"deep": {Type: "string"},
							},
						},
					},
				},
			},
			HeaderParams: map[string]*swagger.SchemaProperty{
				"X-Custom": {
					Type: "string",
				},
			},
			Schema: swagger.SchemaProperty{
				Type: "object",
				Properties: map[string]*swagger.SchemaProperty{
					"bodyField": {
						Type: "object",
						Properties: map[string]*swagger.SchemaProperty{
							"deep": {Type: "string"},
						},
					},
				},
			},
		}

		pruneSchema(&ep.Schema, 0, 1)
		for k := range ep.PathParams {
			pruneSchema(ep.PathParams[k], 0, 1)
		}
		for k := range ep.QueryParams {
			pruneSchema(ep.QueryParams[k], 0, 1)
		}
		for k := range ep.HeaderParams {
			pruneSchema(ep.HeaderParams[k], 0, 1)
		}

		assert.Nil(t, ep.Schema.Properties["bodyField"].Properties)
		assert.Nil(t, ep.PathParams["id"].Properties["nested"].Properties)
		assert.Nil(t, ep.QueryParams["filter"].Properties["nested"].Properties)
		assert.Equal(t, "string", ep.HeaderParams["X-Custom"].Type)
	})
}
