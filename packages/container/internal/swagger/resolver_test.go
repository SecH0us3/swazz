package swagger

import (
	"bytes"
	"encoding/json"
	"log"
	"strings"
	"testing"
)

func TestResolveRef(t *testing.T) {
	specRaw := `{
		"components": {
			"schemas": {
				"User": {
					"type": "object",
					"properties": {
						"id": {"type": "integer"}
					}
				}
			}
		}
	}`

	var spec map[string]any
	json.Unmarshal([]byte(specRaw), &spec)

	resolved := resolveRef("#/components/schemas/User", spec)
	if resolved == nil {
		t.Fatalf("Failed to resolve reference")
	}

	m, ok := resolved.(map[string]any)
	if !ok || m["type"] != "object" {
		t.Errorf("Resolved reference does not have expected type 'object'")
	}
}

func TestResolveSchema_CycleDetection(t *testing.T) {
	specRaw := `{
		"components": {
			"schemas": {
				"A": {
					"type": "object",
					"properties": {
						"b": {
							"$ref": "#/components/schemas/B"
						}
					}
				},
				"B": {
					"type": "object",
					"properties": {
						"a": {
							"$ref": "#/components/schemas/A"
						}
					}
				}
			}
		}
	}`

	var spec map[string]any
	json.Unmarshal([]byte(specRaw), &spec)

	// Attempt to resolve schema A, which references B, which references A
	schemaA := map[string]any{
		"$ref": "#/components/schemas/A",
	}

	// If cycle detection is broken, this will cause a stack overflow
	resolved := resolveSchema(schemaA, spec, nil)

	if resolved.Type != "object" {
		t.Errorf("Expected 'object', got %s", resolved.Type)
	}

	if resolved.Properties == nil || resolved.Properties["b"] == nil {
		t.Fatalf("Expected property 'b' to exist")
	}

	// The property 'a' inside 'b' should be an empty object because of the cycle break
	propA := resolved.Properties["b"].Properties["a"]
	if propA == nil {
		t.Fatalf("Expected property 'a' to exist inside 'b'")
	}

	if propA.Properties != nil && len(propA.Properties) > 0 {
		t.Errorf("Expected property 'a' to be empty object due to cycle break, got properties: %v", propA.Properties)
	}
}

func TestResolveSchema_AllOf(t *testing.T) {
	specRaw := `{
		"components": {
			"schemas": {
				"Base": {
					"type": "object",
					"properties": {
						"id": {"type": "integer"}
					},
					"required": ["id"]
				}
			}
		}
	}`

	var spec map[string]any
	json.Unmarshal([]byte(specRaw), &spec)

	schema := map[string]any{
		"allOf": []any{
			map[string]any{"$ref": "#/components/schemas/Base"},
			map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name": map[string]any{"type": "string"},
				},
				"required": []any{"name"},
			},
		},
	}

	resolved := resolveSchema(schema, spec, nil)

	if resolved.Type != "object" {
		t.Errorf("Expected 'object', got %s", resolved.Type)
	}

	if len(resolved.Properties) != 2 {
		t.Errorf("Expected 2 properties after allOf merge, got %d", len(resolved.Properties))
	}

	if len(resolved.Required) != 2 {
		t.Errorf("Expected 2 required fields after allOf merge, got %d", len(resolved.Required))
	}
}

func TestResolveSchema_PathologicalGraph(t *testing.T) {
	specRaw := `{
		"components": {
			"schemas": {
				"Self": {
					"type": "object",
					"properties": {
						"self": {
							"$ref": "#/components/schemas/Self"
						}
					}
				},
				"A": {
					"type": "object",
					"properties": {
						"b": { "$ref": "#/components/schemas/B" },
						"c": { "$ref": "#/components/schemas/C" }
					}
				},
				"B": {
					"type": "object",
					"properties": {
						"a": { "$ref": "#/components/schemas/A" },
						"c": { "$ref": "#/components/schemas/C" }
					}
				},
				"C": {
					"type": "object",
					"properties": {
						"a": { "$ref": "#/components/schemas/A" },
						"b": { "$ref": "#/components/schemas/B" }
					}
				}
			}
		}
	}`

	var spec map[string]any
	json.Unmarshal([]byte(specRaw), &spec)

	// 1. Test Self-Reference
	resolvedSelf := resolveSchema(map[string]any{"$ref": "#/components/schemas/Self"}, spec, nil)
	if resolvedSelf.Type != "object" {
		t.Errorf("Expected 'object', got %s", resolvedSelf.Type)
	}
	selfProp := resolvedSelf.Properties["self"]
	if selfProp == nil {
		t.Fatalf("Expected property 'self' to exist")
	}
	// It should have resolved to the circular reference fallback (empty object)
	if selfProp.Properties != nil && len(selfProp.Properties) > 0 {
		t.Errorf("Expected self-referencing property to be truncated, got properties: %v", selfProp.Properties)
	}

	// 2. Test Dense Clique
	resolvedA := resolveSchema(map[string]any{"$ref": "#/components/schemas/A"}, spec, nil)
	if resolvedA.Type != "object" {
		t.Errorf("Expected 'object', got %s", resolvedA.Type)
	}
	if resolvedA.Properties["b"] == nil || resolvedA.Properties["c"] == nil {
		t.Fatalf("Expected properties 'b' and 'c' to exist under 'A'")
	}
}

func TestResolveSchema_NodeBudget(t *testing.T) {
	specRaw := `{
		"components": {
			"schemas": {
				"A": {
					"type": "object",
					"properties": {
						"b": {
							"type": "object",
							"properties": {
								"c": { "type": "string" }
							}
						}
					}
				}
			}
		}
	}`
	var spec map[string]any
	json.Unmarshal([]byte(specRaw), &spec)

	ctx := &resolverCtx{
		spec:         spec,
		inProgress:   make(map[string]bool),
		resolvedRefs: make(map[string]*SchemaProperty),
		maxNodes:     2, // Set budget very low to trigger truncation
		maxDepth:     64,
	}

	schema := map[string]any{"$ref": "#/components/schemas/A"}
	resolved := ctx.resolve(schema)

	// Since budget is 2, it should truncate when it tries to resolve nested properties
	if !ctx.truncated {
		t.Errorf("Expected resolution to be truncated due to low node budget")
	}
	if resolved.Type != "object" {
		t.Errorf("Expected truncated fallback type 'object', got '%s'", resolved.Type)
	}
}

func TestResolveSchema_DepthLimit(t *testing.T) {
	specRaw := `{
		"components": {
			"schemas": {
				"A": {
					"type": "object",
					"properties": {
						"b": {
							"type": "object",
							"properties": {
								"c": { "type": "string" }
							}
						}
					}
				}
			}
		}
	}`
	var spec map[string]any
	json.Unmarshal([]byte(specRaw), &spec)

	ctx := &resolverCtx{
		spec:         spec,
		inProgress:   make(map[string]bool),
		resolvedRefs: make(map[string]*SchemaProperty),
		maxNodes:     50000,
		maxDepth:     2, // Set depth limit very low to trigger truncation
	}

	schema := map[string]any{"$ref": "#/components/schemas/A"}
	resolved := ctx.resolve(schema)

	if !ctx.truncated {
		t.Errorf("Expected resolution to be truncated due to low depth limit")
	}
	if resolved.Type != "object" {
		t.Errorf("Expected truncated fallback type 'object', got '%s'", resolved.Type)
	}
}

func TestResolveSchema_WarningsAndHints(t *testing.T) {
	specRaw := `{
		"components": {
			"schemas": {
				"A": {
					"type": "object",
					"properties": {
						"b": {
							"type": "object",
							"properties": {
								"c": { "type": "string" }
							}
						}
					}
				}
			}
		}
	}`
	var spec map[string]any
	json.Unmarshal([]byte(specRaw), &spec)

	// Save original log output and restore after test
	var logBuf bytes.Buffer
	origOutput := log.Writer()
	log.SetOutput(&logBuf)
	defer log.SetOutput(origOutput)

	// 1. Test depth limit warning and hint propagation
	ctxDepth := &resolverCtx{
		spec:         spec,
		inProgress:   make(map[string]bool),
		resolvedRefs: make(map[string]*SchemaProperty),
		maxNodes:     50000,
		maxDepth:     2,
		endpointHint: "POST /api/test-depth",
	}

	logBuf.Reset()
	ctxDepth.resolve(map[string]any{"$ref": "#/components/schemas/A"})

	if !ctxDepth.truncated {
		t.Errorf("Expected resolution to be truncated")
	}
	logStr := logBuf.String()
	expectedDepthWarning := "Schema resolution depth limit (2) reached. Truncated schema. Context: POST /api/test-depth"
	if !strings.Contains(logStr, expectedDepthWarning) {
		t.Errorf("Expected log warning %q, got: %q", expectedDepthWarning, logStr)
	}

	// 2. Test node budget warning and hint propagation
	ctxNode := &resolverCtx{
		spec:         spec,
		inProgress:   make(map[string]bool),
		resolvedRefs: make(map[string]*SchemaProperty),
		maxNodes:     2,
		maxDepth:     64,
		endpointHint: "GET /api/test-nodes",
	}

	logBuf.Reset()
	ctxNode.resolve(map[string]any{"$ref": "#/components/schemas/A"})

	if !ctxNode.truncated {
		t.Errorf("Expected resolution to be truncated")
	}
	logStr = logBuf.String()
	expectedNodeWarning := "Schema resolution node budget (2) exceeded. Truncated schema. Context: GET /api/test-nodes"
	if !strings.Contains(logStr, expectedNodeWarning) {
		t.Errorf("Expected log warning %q, got: %q", expectedNodeWarning, logStr)
	}
}

func TestResolveSchema_ArrayAndEnum(t *testing.T) {
	specRaw := `{
		"components": {
			"schemas": {
				"Item": {
					"type": "string",
					"enum": ["foo", "bar"]
				}
			}
		}
	}`
	var spec map[string]any
	json.Unmarshal([]byte(specRaw), &spec)

	schema := map[string]any{
		"type": "array",
		"items": map[string]any{
			"$ref": "#/components/schemas/Item",
		},
	}

	resolved := resolveSchema(schema, spec, nil)

	if resolved.Type != "array" {
		t.Errorf("Expected type 'array', got '%s'", resolved.Type)
	}
	if resolved.Items == nil {
		t.Fatalf("Expected Items to be resolved")
	}
	if resolved.Items.Type != "string" {
		t.Errorf("Expected items type 'string', got '%s'", resolved.Items.Type)
	}
	if len(resolved.Items.Enum) != 2 || resolved.Items.Enum[0] != "foo" {
		t.Errorf("Expected enum [foo, bar], got %v", resolved.Items.Enum)
	}
}

func TestResolveSchema_EdgeCases(t *testing.T) {
	specRaw := `{
		"components": {
			"schemas": {
				"A": {
					"type": "object"
				},
				"Primitive": "not-a-map"
			}
		}
	}`
	var spec map[string]any
	json.Unmarshal([]byte(specRaw), &spec)

	// 1. Non-map schema input
	resolvedNonMap := resolveSchema("not-a-map", spec, nil)
	if resolvedNonMap.Type != "object" || resolvedNonMap.Properties == nil {
		t.Errorf("Expected default empty object SchemaProperty for non-map schema input, got %+v", resolvedNonMap)
	}

	// 2. Reference not starting with #/
	resolvedExternal := resolveSchema(map[string]any{"$ref": "http://example.com/schema.json"}, spec, nil)
	if resolvedExternal.Properties == nil {
		t.Errorf("Expected default empty object SchemaProperty for external/non-local reference, got %+v", resolvedExternal)
	}

	// 3. Reference pointing to non-existent schemas
	resolvedMissing := resolveSchema(map[string]any{"$ref": "#/components/schemas/NonExistent"}, spec, nil)
	if resolvedMissing.Properties == nil {
		t.Errorf("Expected empty SchemaProperty for missing reference, got %+v", resolvedMissing)
	}

	// 4. Reference pointing to a non-map type in components
	resolvedPrimitive := resolveSchema(map[string]any{"$ref": "#/components/schemas/Primitive"}, spec, nil)
	if resolvedPrimitive.Properties == nil {
		t.Errorf("Expected empty SchemaProperty for primitive reference, got %+v", resolvedPrimitive)
	}
}

func TestParseSpec_WithParserOptions(t *testing.T) {
	specRaw := `{
		"openapi": "3.0.0",
		"info": {"title": "Test API", "version": "1.0"},
		"paths": {
			"/test": {
				"post": {
					"requestBody": {
						"content": {
							"application/json": {
								"schema": {
									"type": "object",
									"properties": {
										"name": {"type": "string"}
									}
								}
							}
						}
					}
				}
			}
		}
	}`

	// Test with node budget that causes truncation
	result, err := ParseRawSpec([]byte(specRaw), WithMaxNodes(1))
	if err != nil {
		t.Fatalf("Failed to parse spec: %v", err)
	}
	
	// Since node budget is 1, the nested "name" property should be truncated to the safe fallback "object" (instead of "string")
	ep := result.Endpoints[0]
	nameProp := ep.Schema.Properties["name"]
	if nameProp == nil {
		t.Fatalf("Expected property 'name' to exist")
	}
	if nameProp.Type != "object" {
		t.Errorf("Expected truncated fallback type 'object' for property 'name', got '%s'", nameProp.Type)
	}
}


