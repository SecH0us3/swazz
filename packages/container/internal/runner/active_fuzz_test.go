// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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

	// 2. Query param mutation
	queryField := targetField{
		Location: "query",
		Path:     []string{"search"},
		Schema:   &swagger.SchemaProperty{Type: "string"},
	}
	mutatedQuery := buildMutatedPayload(baseline, queryField, gen)
	if mutatedQuery.queryParams["search"] == nil {
		t.Error("expected queryParams.search to be populated")
	}

	// 3. Header param mutation
	headerField := targetField{
		Location: "header",
		Path:     []string{"X-Custom"},
		Schema:   &swagger.SchemaProperty{Type: "string"},
	}
	mutatedHeader := buildMutatedPayload(baseline, headerField, gen)
	if mutatedHeader.headers["X-Custom"] == "" {
		t.Error("expected headers.X-Custom to be populated")
	}

	// 4. Path param mutation
	pathField := targetField{
		Location: "path",
		Path:     []string{"userId"},
		Schema:   &swagger.SchemaProperty{Type: "string"},
	}
	mutatedPath := buildMutatedPayload(baseline, pathField, gen)
	if mutatedPath.pathParams["userId"] == "" {
		t.Error("expected pathParams.userId to be populated")
	}
}

func TestHashPayload(t *testing.T) {
	p1 := generatedPayload{
		body: map[string]any{"a": 1},
	}
	p2 := generatedPayload{
		body: map[string]any{"a": 1},
	}
	p3 := generatedPayload{
		body: map[string]any{"a": 2},
	}

	h1 := hashPayload(p1)
	h2 := hashPayload(p2)
	h3 := hashPayload(p3)

	if h1 != h2 {
		t.Errorf("expected h1 == h2, got %d != %d", h1, h2)
	}
	if h1 == h3 {
		t.Errorf("expected h1 != h3 for different payloads")
	}
}

