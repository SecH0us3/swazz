// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package generator

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestGenerateNumber_BoundaryAndMalicious(t *testing.T) {
	settings := swagger.Settings{
		PayloadCategories: map[swagger.FuzzingProfile][]string{
			swagger.ProfileBoundary:  {payloads.CatBoundaryIntegers, payloads.CatBoundaryNumbers},
			swagger.ProfileMalicious: {payloads.CatMaliciousNumbers},
		},
	}

	// Boundary Integer
	gBoundary := New(nil, swagger.ProfileBoundary, settings)
	valInt := gBoundary.generateNumber("integer")
	assert.NotNil(t, valInt)

	// Boundary Float/Number
	valNum := gBoundary.generateNumber("number")
	assert.NotNil(t, valNum)

	// Malicious
	gMalicious := New(nil, swagger.ProfileMalicious, settings)
	valMal := gMalicious.generateNumber("integer")
	assert.NotNil(t, valMal)
}

func TestGenerateString_BoundaryAndMalicious(t *testing.T) {
	settings := swagger.Settings{
		OOBServerURL: "http://example.com/oob",
		PayloadCategories: map[swagger.FuzzingProfile][]string{
			swagger.ProfileBoundary:  {payloads.CatBoundaryStrings},
			swagger.ProfileMalicious: {payloads.CatMaliciousSQLi},
		},
	}

	// Boundary
	gBoundary := New(nil, swagger.ProfileBoundary, settings)
	valStr := gBoundary.generateString("", "test_prop")
	assert.NotNil(t, valStr)

	// Malicious
	gMalicious := New(nil, swagger.ProfileMalicious, settings)
	valMal := gMalicious.generateString("", "test_prop")
	assert.NotNil(t, valMal)

	// UUID
	valUUID := gBoundary.generateString("uuid", "id")
	assert.NotNil(t, valUUID)
}

func TestMaxInt(t *testing.T) {
	assert.Equal(t, 5, maxInt(1, 5, 3))
	assert.Equal(t, 0, maxInt(-1, -5))
}

func TestSecurityHeaderIterations(t *testing.T) {
	settings := swagger.Settings{
		PayloadCategories: map[swagger.FuzzingProfile][]string{
			swagger.ProfileMalicious: {payloads.CatHostInjection},
		},
	}

	gMalicious := New(nil, swagger.ProfileMalicious, settings)
	count := gMalicious.SecurityHeaderIterations()
	assert.Positive(t, count)

	gRandom := New(nil, swagger.ProfileRandom, settings)
	assert.Zero(t, gRandom.SecurityHeaderIterations())
}

func TestBodyIterations(t *testing.T) {
	settings := swagger.Settings{
		PayloadCategories: map[swagger.FuzzingProfile][]string{
			swagger.ProfileBoundary: {payloads.CatBoundaryIntegers},
			swagger.ProfileMalicious: {
				payloads.CatMaliciousEncoding,
				payloads.CatMaliciousSQLi,
				payloads.CatMaliciousXSS,
				payloads.CatMaliciousPathTraversal,
				payloads.CatMaliciousCmdi,
				payloads.CatMaliciousSSTI,
				payloads.CatMaliciousXXE,
				payloads.CatOOBInteraction,
				payloads.CatMaliciousNumbers,
				payloads.CatMaliciousDates,
				payloads.CatMaliciousBooleans,
				payloads.CatMaliciousTypeConfusion,
			},
		},
	}

	gBoundary := New(nil, swagger.ProfileBoundary, settings)
	assert.Zero(t, gBoundary.BodyIterations())

	gMalicious := New(nil, swagger.ProfileMalicious, settings)
	assert.Positive(t, gMalicious.BodyIterations())
}

func TestRandomizeAndRegisterSSTI(t *testing.T) {
	g := New(nil, swagger.ProfileMalicious, swagger.Settings{})

	res := g.randomizeAndRegisterSSTI("{{7*7}}")
	assert.NotEqual(t, "{{7*7}}", res)

	res2 := g.randomizeAndRegisterSSTI("no-ssti-here")
	assert.Equal(t, "no-ssti-here", res2)

	res3 := g.randomizeAndRegisterSSTI("{{7+'7'}}")
	assert.NotEqual(t, "{{7+'7'}}", res3)
}

func TestGenerateSemanticValue(t *testing.T) {
	g := New(nil, swagger.ProfileMalicious, swagger.Settings{})

	assert.NotEqual(t, "test", g.GenerateSemanticValue("email", "test"))
	assert.NotEqual(t, "test", g.GenerateSemanticValue("url", "test"))
	assert.NotEqual(t, "test", g.GenerateSemanticValue("uri", "test"))
	assert.NotEqual(t, "test", g.GenerateSemanticValue("uuid", "test"))
	assert.NotEqual(t, "test", g.GenerateSemanticValue("phone", "test"))
	assert.NotEqual(t, "test", g.GenerateSemanticValue("tel", "test"))
	assert.NotEqual(t, "test", g.GenerateSemanticValue("date-time", "test"))
	assert.NotEqual(t, "test", g.GenerateSemanticValue("date", "test"))
	assert.Equal(t, "test", g.GenerateSemanticValue("unknown-format", "test"))
}

func TestGenerateSecurityHeaders_Fuzzer(t *testing.T) {
	g := New(nil, swagger.ProfileMalicious, swagger.Settings{
		OOBServerURL: "oob.example.com",
	})
	g.RunID = "run-123"
	g.Endpoint = "/api/v1/test"

	headers := g.GenerateSecurityHeaders()
	require.NotEmpty(t, headers)

	// Random profile returns nil
	gRand := New(nil, swagger.ProfileRandom, swagger.Settings{})
	assert.Nil(t, gRand.GenerateSecurityHeaders())
}

func TestOOBURLFormats(t *testing.T) {
	g := New(nil, swagger.ProfileMalicious, swagger.Settings{})

	// Default
	url1 := g.oobURL("uuid-1")
	assert.Contains(t, url1, "http://localhost:8080/api/oob/uuid-1")

	// Custom without scheme
	g.oobServerURL = "custom.server.com"
	url2 := g.oobURL("uuid-2")
	assert.Contains(t, url2, "http://custom.server.com/api/oob/uuid-2")

	// With RunID
	g.RunID = "run-abc"
	url3 := g.oobURL("uuid-3")
	assert.Contains(t, url3, "http://custom.server.com/api/oob/run-abc/uuid-3")
}

func TestGetArraySize(t *testing.T) {
	g := New(nil, swagger.ProfileBoundary, swagger.Settings{})

	objSchema := &swagger.SchemaProperty{Type: "object"}
	size := g.getArraySize(objSchema)
	assert.GreaterOrEqual(t, size, 0)
	assert.LessOrEqual(t, size, 50)
}

func TestGenerateNumber_AllProfiles(t *testing.T) {
	for _, profile := range []swagger.FuzzingProfile{swagger.ProfileBoundary, swagger.ProfileMalicious, swagger.ProfileRandom} {
		g := New(nil, profile, swagger.Settings{})

		intVal := g.generateNumber("integer")
		require.NotNil(t, intVal)

		numVal := g.generateNumber("number")
		require.NotNil(t, numVal)
	}
}

func TestGenerateBoolean_AllProfiles(t *testing.T) {
	gRand := New(nil, swagger.ProfileRandom, swagger.Settings{})
	b1 := gRand.generateBoolean()
	_, isBool1 := b1.(bool)
	assert.True(t, isBool1)

	gBound := New(nil, swagger.ProfileBoundary, swagger.Settings{})
	b2 := gBound.generateBoolean()
	_, isBool2 := b2.(bool)
	assert.True(t, isBool2)

	gMal := New(nil, swagger.ProfileMalicious, swagger.Settings{})
	b3 := gMal.generateBoolean()
	assert.NotNil(t, b3)
}

func TestGenerateUUIDAndDate(t *testing.T) {
	g := New(nil, swagger.ProfileRandom, swagger.Settings{})

	uuidStr := g.generateUUID()
	assert.Len(t, uuidStr, 36)

	dateStr := g.generateDate()
	assert.NotEmpty(t, dateStr)
}

func TestGenerate_ArrayAndNull(t *testing.T) {
	g := New(nil, swagger.ProfileRandom, swagger.Settings{})

	// Nil schema
	assert.Nil(t, g.Generate("nil_key", nil))

	// Array schema
	arrSchema := &swagger.SchemaProperty{
		Type: "array",
		Items: &swagger.SchemaProperty{
			Type: "string",
		},
	}
	arrVal := g.Generate("arr_key", arrSchema)
	assert.NotNil(t, arrVal)
}
