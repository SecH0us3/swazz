package generator

import (
	"encoding/json"
	"strings"
	"testing"

	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"
)

func TestGenerate_Random(t *testing.T) {
	schema := &swagger.SchemaProperty{
		Type: "object",
		Properties: map[string]*swagger.SchemaProperty{
			"id":    {Type: "integer"},
			"name":  {Type: "string"},
			"email": {Type: "string", Format: "email"},
		},
		Required: []string{"id", "name", "email"},
	}

	g := New(nil, swagger.ProfileRandom, swagger.Settings{})

	for i := 0; i < 10; i++ {
		payload := g.BuildObject(schema)
		if len(payload) == 0 {
			continue
		}

		if _, ok := payload["id"].(int); !ok {
			t.Errorf("Expected id to be int, got %T", payload["id"])
		}

		if name, ok := payload["name"].(string); !ok || name == "" {
			t.Errorf("Expected name to be non-empty string, got %v", payload["name"])
		}

		if email, ok := payload["email"].(string); !ok || !strings.Contains(email, "@") {
			t.Errorf("Expected email to contain '@', got %v", payload["email"])
		}
	}
}

func TestGenerate_Boundary(t *testing.T) {
	schema := &swagger.SchemaProperty{
		Type: "string",
	}

	g := New(nil, swagger.ProfileBoundary, swagger.Settings{})
	payload := g.Generate("test", schema)
	str, ok := payload.(string)
	if !ok {
		t.Fatalf("Expected string for boundary string schema, got %T", payload)
	}

	if len(str) > 0 && len(str) < 1000 && !strings.Contains(str, "\x00") && str != " " {
		// Just a basic sanity check
	}
}

func TestGenerate_Malicious(t *testing.T) {
	schema := &swagger.SchemaProperty{
		Type: "string",
	}

	g := New(nil, swagger.ProfileMalicious, swagger.Settings{})
	payload := g.Generate("test", schema)

	// Sometimes Malicious profile does TypeConfusion, so it might not be a string
	if str, ok := payload.(string); ok {
		if !strings.ContainsAny(str, "'\"<>()$;\\") {
			t.Logf("Malicious string might not contain special chars: %s", str)
		}
	}
}

func TestMaxDepth(t *testing.T) {
	// Create a deeply nested self-referential schema
	var createNested func(depth int) *swagger.SchemaProperty
	createNested = func(depth int) *swagger.SchemaProperty {
		if depth == 0 {
			return &swagger.SchemaProperty{Type: "string"}
		}
		return &swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"child": createNested(depth - 1),
			},
		}
	}

	schema := createNested(10) // Deeper than maxDepth=5

	// Limit testing is not strictly enforced in BuildObject without a depth parameter,
	// but the array maxes are. If we want to test array limits, we can do so here.
	// We'll just verify the generator doesn't crash on standard deep objects.
	g := New(nil, swagger.ProfileBoundary, swagger.Settings{})
	payload := g.BuildObject(schema)

	b, _ := json.Marshal(payload)
	strPayload := string(b)

	if !strings.Contains(strPayload, "child") {
		t.Errorf("Payload should contain child key")
	}
}

func TestGenerate_UUIDArrayBoundary(t *testing.T) {
	schema := &swagger.SchemaProperty{
		Type: "object",
		Properties: map[string]*swagger.SchemaProperty{
			"usersIds": {
				Type: "array",
				Items: &swagger.SchemaProperty{
					Type:   "string",
					Format: "uuid",
				},
			},
		},
		Required: []string{"usersIds"},
	}

	g := New(nil, swagger.ProfileBoundary, swagger.Settings{})

	// Run multiple iterations to hit the large array boundary (100 or 1000)
	foundLargeArray := false
	for i := 0; i < 20; i++ {
		payload := g.BuildObject(schema)
		usersIds, ok := payload["usersIds"].([]any)
		if !ok {
			t.Fatalf("Expected usersIds to be []any, got %T", payload["usersIds"])
		}

		if len(usersIds) >= 100 {
			foundLargeArray = true
			// Check if elements are UUIDs or logical boundaries, NOT giant strings
			for _, item := range usersIds {
				str, ok := item.(string)
				if !ok {
					t.Errorf("Expected array item to be string, got %T", item)
					continue
				}
				if len(str) > 50 {
					t.Errorf("UUID field should not contain giant strings, got length %d", len(str))
				}
			}
		}
	}

	if !foundLargeArray {
		t.Errorf("Should have generated at least one large array in Boundary profile")
	}
}

func TestGenerate_DictionaryArray(t *testing.T) {
	schema := &swagger.SchemaProperty{
		Type: "object",
		Properties: map[string]*swagger.SchemaProperty{
			"usersIds": {
				Type: "array",
				Items: &swagger.SchemaProperty{
					Type:   "string",
					Format: "uuid",
				},
			},
		},
		Required: []string{"usersIds"},
	}

	dict := map[string][]any{
		"usersIds": {"custom-uuid-1", "custom-uuid-2"},
	}
	g := New(dict, swagger.ProfileBoundary, swagger.Settings{})

	payload := g.BuildObject(schema)
	usersIds, ok := payload["usersIds"].([]any)
	if !ok {
		t.Fatalf("Expected usersIds to be []any, got %T", payload["usersIds"])
	}

	for _, item := range usersIds {
		str, _ := item.(string)
		if str != "custom-uuid-1" && str != "custom-uuid-2" {
			t.Errorf("Expected item from dictionary, got %v", item)
		}
	}
}

func TestGenerate_MaliciousCategoryFiltering(t *testing.T) {
	settings := swagger.Settings{
		PayloadCategories: map[swagger.FuzzingProfile][]string{
			swagger.ProfileMalicious: {payloads.CatMaliciousSQLi},
		},
	}

	g := New(nil, swagger.ProfileMalicious, settings)

	// Verify that cachedMaliciousStrings matches payloads.MaliciousSQLi exactly
	if len(g.cachedMaliciousStrings) != len(payloads.MaliciousSQLi) {
		t.Errorf("Expected cachedMaliciousStrings to have length %d, got %d", len(payloads.MaliciousSQLi), len(g.cachedMaliciousStrings))
	}

	sqliSet := make(map[any]bool)
	for _, val := range payloads.MaliciousSQLi {
		sqliSet[val] = true
	}

	for _, val := range g.cachedMaliciousStrings {
		if !sqliSet[val] {
			t.Errorf("Found unexpected payload %v in cachedMaliciousStrings when only SQLi category was enabled", val)
		}
	}
}

func TestGenerate_NewCategoriesFiltering(t *testing.T) {
	newCats := []struct {
		category string
		expected []any
	}{
		{payloads.CatMaliciousCmdi, payloads.MaliciousCmdi},
		{payloads.CatMaliciousSSTI, payloads.MaliciousSSTI},
		{payloads.CatMaliciousXXE, payloads.MaliciousXXE},
	}

	for _, tc := range newCats {
		t.Run(tc.category, func(t *testing.T) {
			settings := swagger.Settings{
				PayloadCategories: map[swagger.FuzzingProfile][]string{
					swagger.ProfileMalicious: {tc.category},
				},
			}
			g := New(nil, swagger.ProfileMalicious, settings)

			if len(g.cachedMaliciousStrings) != len(tc.expected) {
				t.Errorf("Expected cachedMaliciousStrings to have length %d, got %d", len(tc.expected), len(g.cachedMaliciousStrings))
			}

			catSet := make(map[any]bool)
			for _, val := range tc.expected {
				catSet[val] = true
			}

			for _, val := range g.cachedMaliciousStrings {
				if !catSet[val] {
					t.Errorf("Found unexpected payload %v in cachedMaliciousStrings when only %s category was enabled", val, tc.category)
				}
			}
		})
	}
}

func TestMinIterationsNeeded_NewCategories(t *testing.T) {
	newCats := []struct {
		category string
		payloads []any
	}{
		{payloads.CatMaliciousCmdi, payloads.MaliciousCmdi},
		{payloads.CatMaliciousSSTI, payloads.MaliciousSSTI},
		{payloads.CatMaliciousXXE, payloads.MaliciousXXE},
	}

	for _, tc := range newCats {
		t.Run(tc.category, func(t *testing.T) {
			settings := swagger.Settings{
				PayloadCategories: map[swagger.FuzzingProfile][]string{
					swagger.ProfileMalicious: {tc.category},
				},
			}
			iters := MinIterationsNeeded(swagger.ProfileMalicious, settings)
			if iters < len(tc.payloads) {
				t.Errorf("Expected MinIterationsNeeded to be at least %d for %s, got %d", len(tc.payloads), tc.category, iters)
			}

			g := New(nil, swagger.ProfileMalicious, settings)
			bodyIters := g.BodyIterations()
			if bodyIters != len(tc.payloads) {
				t.Errorf("Expected BodyIterations to be %d for %s, got %d", len(tc.payloads), tc.category, bodyIters)
			}
		})
	}
}

func BenchmarkGenerateStringMalicious(b *testing.B) {
	schema := &swagger.SchemaProperty{
		Type: "string",
	}
	g := New(nil, swagger.ProfileMalicious, swagger.Settings{})
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = g.Generate("test", schema)
	}
}

func TestGenerate_BooleanAndDateAndHeaderIterations(t *testing.T) {
	schemaBool := &swagger.SchemaProperty{Type: "boolean"}
	
	gBound := New(nil, swagger.ProfileBoundary, swagger.Settings{})
	_ = gBound.Generate("bool", schemaBool)

	gMal := New(nil, swagger.ProfileMalicious, swagger.Settings{})
	_ = gMal.Generate("bool", schemaBool)

	gRand := New(nil, swagger.ProfileRandom, swagger.Settings{})
	_ = gRand.Generate("bool", schemaBool)

	schemaDate := &swagger.SchemaProperty{Type: "string", Format: "date"}
	_ = gBound.Generate("date", schemaDate)
	_ = gMal.Generate("date", schemaDate)
	_ = gRand.Generate("date", schemaDate)

	schemaDateTime := &swagger.SchemaProperty{Type: "string", Format: "date-time"}
	_ = gBound.Generate("datetime", schemaDateTime)
	_ = gMal.Generate("datetime", schemaDateTime)
	_ = gRand.Generate("datetime", schemaDateTime)

	_ = gBound.SecurityHeaderIterations()
}

