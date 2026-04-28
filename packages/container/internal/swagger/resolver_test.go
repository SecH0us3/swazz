package swagger

import (
	"encoding/json"
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
