package runner

import (
	"testing"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
	"github.com/stretchr/testify/assert"
)

func TestBuildPathParams(t *testing.T) {
	gen := generator.New(nil, swagger.ProfileRandom, swagger.Settings{})

	// Test empty path params
	ep := swagger.EndpointConfig{
		Path: "/api/goods",
	}
	out := buildPathParams(ep, gen)
	assert.Nil(t, out)

	// Test path params with nil schema fallback
	ep = swagger.EndpointConfig{
		Path: "/api/goods/{id}",
		PathParams: map[string]*swagger.SchemaProperty{
			"id": nil,
		},
	}
	out = buildPathParams(ep, gen)
	assert.NotNil(t, out)
	assert.Contains(t, out, "id")

	// Test path params with defined schema
	ep = swagger.EndpointConfig{
		Path: "/api/goods/{id}",
		PathParams: map[string]*swagger.SchemaProperty{
			"id": {Type: "integer"},
		},
	}
	out = buildPathParams(ep, gen)
	assert.NotNil(t, out)
	assert.Contains(t, out, "id")
}

func TestBuildSafePayload_Example(t *testing.T) {
	gen := generator.New(nil, swagger.ProfileRandom, swagger.Settings{})

	// Example defined (body method)
	ep := swagger.EndpointConfig{
		Method: "POST",
		Example: map[string]any{
			"name": "User 1 Secret Files",
		},
	}
	out := buildSafePayload(ep, gen)
	assert.Equal(t, map[string]any{"name": "User 1 Secret Files"}, out.body)
	assert.Nil(t, out.queryParams)

	// Example defined (non-body method)
	ep = swagger.EndpointConfig{
		Method: "GET",
		Example: map[string]any{
			"limit": "10",
		},
	}
	out = buildSafePayload(ep, gen)
	assert.Nil(t, out.body)
	assert.Equal(t, map[string]any{"limit": "10"}, out.queryParams)
}

func TestBuildSafePayload_Schema(t *testing.T) {
	gen := generator.New(nil, swagger.ProfileRandom, swagger.Settings{})

	// No fields or example
	ep := swagger.EndpointConfig{
		Method: "GET",
	}
	out := buildSafePayload(ep, gen)
	assert.Nil(t, out.body)
	assert.Nil(t, out.queryParams)

	// With schema fields
	ep = swagger.EndpointConfig{
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"name": {Type: "string"},
			},
		},
	}
	out = buildSafePayload(ep, gen)
	assert.NotNil(t, out.body)
}

func TestBuildFuzzPayload(t *testing.T) {
	gen := generator.New(nil, swagger.ProfileRandom, swagger.Settings{})
	safeGen := generator.New(nil, swagger.ProfileRandom, swagger.Settings{})

	// No fields
	ep := swagger.EndpointConfig{
		Method: "GET",
	}
	out := buildFuzzPayload(ep, gen, safeGen, false, false)
	assert.Nil(t, out.body)
	assert.Nil(t, out.queryParams)

	// GET method combining schema properties and query parameters
	ep = swagger.EndpointConfig{
		Method: "GET",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"search": {Type: "string"},
			},
		},
		QueryParams: map[string]*swagger.SchemaProperty{
			"limit": {Type: "integer"},
		},
	}
	out = buildFuzzPayload(ep, gen, safeGen, false, false)
	assert.NotNil(t, out.queryParams)

	// POST method with query parameters and body schema
	ep = swagger.EndpointConfig{
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"name": {Type: "string"},
			},
		},
		QueryParams: map[string]*swagger.SchemaProperty{
			"debug": {Type: "boolean"},
		},
	}
	out = buildFuzzPayload(ep, gen, safeGen, false, false)
	assert.NotNil(t, out.body)
	assert.NotNil(t, out.queryParams)
}

func TestBuildHeaders(t *testing.T) {
	gen := generator.New(nil, swagger.ProfileRandom, swagger.Settings{})

	// Empty headers schema
	ep := swagger.EndpointConfig{}
	out := buildHeaders(ep, gen)
	assert.Nil(t, out)

	// Defined headers schema
	ep = swagger.EndpointConfig{
		HeaderParams: map[string]*swagger.SchemaProperty{
			"X-Custom-Header": {Type: "string"},
		},
	}
	out = buildHeaders(ep, gen)
	assert.NotNil(t, out)
	assert.Contains(t, out, "X-Custom-Header")
}

func TestMergeProps(t *testing.T) {
	// Nil inputs
	out := mergeProps(nil, nil)
	assert.Nil(t, out)

	// Non-empty merge
	a := map[string]*swagger.SchemaProperty{
		"k1": {Type: "string"},
	}
	b := map[string]*swagger.SchemaProperty{
		"k2": {Type: "integer"},
	}
	out = mergeProps(a, b)
	assert.Equal(t, 2, len(out))
	assert.Equal(t, "string", out["k1"].Type)
	assert.Equal(t, "integer", out["k2"].Type)
}
