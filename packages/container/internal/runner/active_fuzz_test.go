package runner

import (
	"reflect"
	"testing"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
)

func TestCollectTargetFields(t *testing.T) {
	ep := &swagger.EndpointConfig{
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"name": {Type: "string"},
				"info": {
					Type: "object",
					Properties: map[string]*swagger.SchemaProperty{
						"age": {Type: "integer"},
					},
				},
			},
		},
		QueryParams: map[string]*swagger.SchemaProperty{
			"search": {Type: "string"},
		},
		PathParams: map[string]*swagger.SchemaProperty{
			"id": {Type: "string"},
		},
		HeaderParams: map[string]*swagger.SchemaProperty{
			"X-Token": {Type: "string"},
		},
	}

	fields := collectTargetFields(ep)

	// We expect:
	// - body: "name"
	// - body: "info.age"
	// - query: "search"
	// - path: "id"
	// - header: "X-Token"
	if len(fields) != 5 {
		t.Errorf("Expected 5 target fields, got %d", len(fields))
	}

	locations := make(map[string]bool)
	for _, f := range fields {
		locations[f.Location] = true
	}
	expectedLocs := []string{"body", "query", "path", "header"}
	for _, loc := range expectedLocs {
		if !locations[loc] {
			t.Errorf("Expected target field location %s to be collected", loc)
		}
	}
}

func TestClonePayload(t *testing.T) {
	orig := generatedPayload{
		body: map[string]any{
			"name": "john",
			"info": map[string]any{
				"age": 30,
			},
		},
		queryParams: map[string]any{
			"search": "test",
		},
		headers: map[string]string{
			"X-Test": "123",
		},
		pathParams: map[string]string{
			"id": "abc",
		},
	}

	cloned := clonePayload(orig)

	// Verify deep copy by mutating cloned maps and checking orig remains unchanged
	cloned.body["name"] = "jack"
	if orig.body["name"] == "jack" {
		t.Error("clonePayload failed to deep copy body name")
	}

	clonedBodyInfo := cloned.body["info"].(map[string]any)
	clonedBodyInfo["age"] = 40
	origBodyInfo := orig.body["info"].(map[string]any)
	if origBodyInfo["age"] == 40 {
		t.Error("clonePayload failed to deep copy nested body properties")
	}

	cloned.queryParams["search"] = "new"
	if orig.queryParams["search"] == "new" {
		t.Error("clonePayload failed to deep copy queryParams")
	}

	cloned.headers["X-Test"] = "456"
	if orig.headers["X-Test"] == "456" {
		t.Error("clonePayload failed to deep copy headers")
	}
}

func TestSetNestedValue(t *testing.T) {
	m := map[string]any{
		"name": "john",
		"address": map[string]any{
			"city": "Paris",
		},
	}

	setNestedValue(m, []string{"address", "city"}, "London")
	addr := m["address"].(map[string]any)
	if addr["city"] != "London" {
		t.Errorf("setNestedValue failed to set nested property: expected London, got %v", addr["city"])
	}

	setNestedValue(m, []string{"address", "zip"}, "75001")
	if addr["zip"] != "75001" {
		t.Errorf("setNestedValue failed to set new nested property: expected 75001, got %v", addr["zip"])
	}
}

func TestBuildMutatedPayload(t *testing.T) {
	baseline := generatedPayload{
		body: map[string]any{
			"name": "john",
			"age":  30,
		},
	}

	field := targetField{
		Location: "body",
		Path:     []string{"name"},
		Schema:   &swagger.SchemaProperty{Type: "string"},
	}

	dict := map[string][]any{}
	gen := generator.New(dict, swagger.ProfileRandom, swagger.DefaultSettings())

	mutated := buildMutatedPayload(baseline, field, gen)

	// Fuzzed value for "name" should be mutated, while "age" remains at 30
	if reflect.DeepEqual(baseline.body, mutated.body) {
		t.Error("buildMutatedPayload failed to mutate target property")
	}
	if mutated.body["age"] != 30 {
		t.Errorf("buildMutatedPayload changed non-target property: expected 30, got %v", mutated.body["age"])
	}
}
