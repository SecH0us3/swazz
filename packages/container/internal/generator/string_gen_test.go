// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package generator

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/oob"
	"swazz-engine/internal/sstistore"
	"swazz-engine/internal/swagger"
)

func TestStringGen_GenerateSemanticValue(t *testing.T) {
	t.Parallel()

	g := New(nil, swagger.ProfileRandom, swagger.Settings{})
	vector := "<script>alert(1)</script>"

	formats := []struct {
		format      string
		expectedSet []string
	}{
		{format: "email", expectedSet: WrapEmail(vector)},
		{format: "EMAIL", expectedSet: WrapEmail(vector)},
		{format: "date", expectedSet: WrapDateTime(vector)},
		{format: "date-time", expectedSet: WrapDateTime(vector)},
		{format: "DATE-TIME", expectedSet: WrapDateTime(vector)},
		{format: "uri", expectedSet: WrapURL(vector)},
		{format: "url", expectedSet: WrapURL(vector)},
		{format: "URI", expectedSet: WrapURL(vector)},
		{format: "uuid", expectedSet: WrapUUID(vector)},
		{format: "UUID", expectedSet: WrapUUID(vector)},
		{format: "phone", expectedSet: WrapPhone(vector)},
		{format: "tel", expectedSet: WrapPhone(vector)},
		{format: "TEL", expectedSet: WrapPhone(vector)},
	}

	for _, tc := range formats {
		t.Run(tc.format, func(t *testing.T) {
			res := g.GenerateSemanticValue(tc.format, vector)
			if strings.EqualFold(tc.format, "uuid") {
				parts := strings.SplitN(res, "#", 2)
				_, err := uuid.Parse(parts[0])
				assert.NoError(t, err)
			} else {
				assert.Contains(t, tc.expectedSet, res)
			}
		})
	}

	t.Run("unknown format returns vector unchanged", func(t *testing.T) {
		res := g.GenerateSemanticValue("unknown_custom_format", vector)
		assert.Equal(t, vector, res)
	})

	t.Run("empty format returns vector unchanged", func(t *testing.T) {
		res := g.GenerateSemanticValue("", vector)
		assert.Equal(t, vector, res)
	})
}

func TestStringGen_GenerateString_Random(t *testing.T) {
	t.Parallel()

	g := New(nil, swagger.ProfileRandom, swagger.Settings{})

	t.Run("plain string", func(t *testing.T) {
		val := g.generateString("", "")
		str, ok := val.(string)
		require.True(t, ok)
		assert.NotEmpty(t, str)
	})

	t.Run("email propName", func(t *testing.T) {
		val := g.generateString("", "contact_email")
		str, ok := val.(string)
		require.True(t, ok)
		assert.Contains(t, str, "@")
	})

	t.Run("id propName", func(t *testing.T) {
		val := g.generateString("", "user_id")
		str, ok := val.(string)
		require.True(t, ok)
		_, err := uuid.Parse(str)
		assert.NoError(t, err)
	})

	t.Run("slug propName", func(t *testing.T) {
		val := g.generateString("", "post_slug")
		str, ok := val.(string)
		require.True(t, ok)
		assert.NotEmpty(t, str)
	})

	t.Run("name propName", func(t *testing.T) {
		val := g.generateString("", "first_name")
		str, ok := val.(string)
		require.True(t, ok)
		assert.NotEmpty(t, str)
	})

	t.Run("numeric propName", func(t *testing.T) {
		val := g.generateString("", "page_num")
		num, ok := val.(int)
		require.True(t, ok)
		assert.GreaterOrEqual(t, num, 1)
		assert.LessOrEqual(t, num, 100)
	})

	t.Run("generateStringArrayItem", func(t *testing.T) {
		val := g.generateStringArrayItem("", "user_email")
		str, ok := val.(string)
		require.True(t, ok)
		assert.Contains(t, str, "@")
	})
}

func TestStringGen_GenerateString_Boundary(t *testing.T) {
	t.Parallel()

	t.Run("boundary standard", func(t *testing.T) {
		g := New(nil, swagger.ProfileBoundary, swagger.Settings{})
		val := g.generateString("", "")
		assert.IsType(t, "", val)
	})

	t.Run("boundary array item capped at 1024", func(t *testing.T) {
		g := New(nil, swagger.ProfileBoundary, swagger.Settings{})
		for range 50 {
			val := g.generateStringArrayItem("", "")
			if str, ok := val.(string); ok {
				assert.LessOrEqual(t, len(str), 1024)
			}
		}
	})

	t.Run("boundary capped by MaxPayloadSizeBytes", func(t *testing.T) {
		g := New(nil, swagger.ProfileBoundary, swagger.Settings{MaxPayloadSizeBytes: 64})
		for range 50 {
			val := g.generateString("", "")
			if str, ok := val.(string); ok {
				assert.LessOrEqual(t, len(str), 64)
			}
		}
	})

	t.Run("boundary with category disabled falls back to random", func(t *testing.T) {
		g := New(nil, swagger.ProfileBoundary, swagger.Settings{
			PayloadCategories: map[swagger.FuzzingProfile][]string{
				swagger.ProfileBoundary: {"disabled_cat"},
			},
		})
		val := g.generateString("", "user_id")
		str, ok := val.(string)
		require.True(t, ok)
		_, err := uuid.Parse(str)
		assert.NoError(t, err)
	})
}

func TestStringGen_GenerateString_Malicious(t *testing.T) {
	t.Parallel()

	t.Run("malicious standard returns non-empty value", func(t *testing.T) {
		g := New(nil, swagger.ProfileMalicious, swagger.Settings{})
		val := g.generateString("", "")
		require.NotNil(t, val)
	})

	t.Run("malicious format uuid produces valid uuid", func(t *testing.T) {
		g := New(nil, swagger.ProfileMalicious, swagger.Settings{})
		val := g.generateString("uuid", "")
		str, ok := val.(string)
		require.True(t, ok)
		_, err := uuid.Parse(str)
		assert.NoError(t, err)
	})

	t.Run("malicious with semantic mutation wraps format", func(t *testing.T) {
		tr := true
		g := New(nil, swagger.ProfileMalicious, swagger.Settings{
			EnableSemanticMutation: &tr,
		})
		val := g.generateString("email", "")
		str, ok := val.(string)
		require.True(t, ok)
		assert.Contains(t, str, "@")
	})

	t.Run("malicious with OOB_URL replaces token and registers context", func(t *testing.T) {
		g := &Generator{
			profile:                   swagger.ProfileMalicious,
			hasActiveMaliciousStrings: true,
			cachedMaliciousStrings:    []any{"http://attacker.com/leak?url={{OOB_URL}}"},
			oobServerURL:              "http://oob.swazz.test:8080",
			RunID:                     "test-run-123",
			Endpoint:                  "/api/v1/ping",
		}
		val := g.generateString("", "")
		str, ok := val.(string)
		require.True(t, ok)
		assert.NotContains(t, str, "{{OOB_URL}}")
		assert.Contains(t, str, "http://oob.swazz.test:8080/api/oob/test-run-123/")

		// Verify OOB registration in global store
		parts := strings.Split(str, "/")
		registeredUUID := parts[len(parts)-1]
		ctx, found := oob.GlobalStore.GetAndRemoveUUID(registeredUUID)
		require.True(t, found)
		assert.Equal(t, "test-run-123", ctx.SessionID)
		assert.Equal(t, "/api/v1/ping", ctx.Endpoint)
	})

	t.Run("malicious with SSTI token randomizes and registers", func(t *testing.T) {
		g := &Generator{
			profile:                   swagger.ProfileMalicious,
			hasActiveMaliciousStrings: true,
			cachedMaliciousStrings:    []any{"prefix_{{7*7}}_suffix"},
		}
		val := g.generateString("", "")
		str, ok := val.(string)
		require.True(t, ok)
		assert.NotContains(t, str, "{{7*7}}") // the SSTI probe token was replaced; random primes may incidentally contain "7*7"
		ctx, found := sstistore.GlobalStore.Get(str)
		require.True(t, found)
		assert.NotEmpty(t, ctx.RawExpr)
		assert.NotEmpty(t, ctx.Expected)
	})

	t.Run("malicious with no active strings falls back to random", func(t *testing.T) {
		g := New(nil, swagger.ProfileMalicious, swagger.Settings{
			PayloadCategories: map[swagger.FuzzingProfile][]string{
				swagger.ProfileMalicious: {"disabled_cat"},
			},
		})
		val := g.generateString("", "contact_email")
		str, ok := val.(string)
		require.True(t, ok)
		assert.Contains(t, str, "@")
	})
}

func TestStringGen_GetActiveMaliciousStrings(t *testing.T) {
	t.Parallel()

	t.Run("all categories enabled by default", func(t *testing.T) {
		g := New(nil, swagger.ProfileMalicious, swagger.Settings{})
		all, hasAny := g.getActiveMaliciousStrings()
		assert.True(t, hasAny)
		assert.NotEmpty(t, all)
	})

	t.Run("no categories enabled returns fallback word and false", func(t *testing.T) {
		g := New(nil, swagger.ProfileMalicious, swagger.Settings{
			PayloadCategories: map[swagger.FuzzingProfile][]string{
				swagger.ProfileMalicious: {"non_existent_category"},
			},
		})
		all, hasAny := g.getActiveMaliciousStrings()
		assert.False(t, hasAny)
		assert.Len(t, all, 1)
	})
}

func TestStringGen_GenerateDate(t *testing.T) {
	t.Parallel()

	t.Run("random profile produces RFC3339 formatted date", func(t *testing.T) {
		g := New(nil, swagger.ProfileRandom, swagger.Settings{})
		for range 10 {
			val := g.generateDate()
			str, ok := val.(string)
			require.True(t, ok)
			parsed, err := time.Parse("2006-01-02T15:04:05.000Z", str)
			assert.NoError(t, err)
			assert.False(t, parsed.IsZero())
		}
	})

	t.Run("boundary profile produces boundary date", func(t *testing.T) {
		g := New(nil, swagger.ProfileBoundary, swagger.Settings{})
		val := g.generateDate()
		assert.NotNil(t, val)
	})

	t.Run("malicious profile produces malicious date", func(t *testing.T) {
		g := New(nil, swagger.ProfileMalicious, swagger.Settings{})
		val := g.generateDate()
		assert.NotNil(t, val)
	})
}

func TestStringGen_GenerateUUID(t *testing.T) {
	t.Parallel()

	t.Run("random profile produces valid UUID", func(t *testing.T) {
		g := New(nil, swagger.ProfileRandom, swagger.Settings{})
		for range 10 {
			val := g.generateUUID()
			str, ok := val.(string)
			require.True(t, ok)
			parsed, err := uuid.Parse(str)
			assert.NoError(t, err)
			assert.NotEqual(t, uuid.Nil, parsed)
		}
	})

	t.Run("boundary profile produces UUID or boundary variant", func(t *testing.T) {
		g := New(nil, swagger.ProfileBoundary, swagger.Settings{})
		for range 10 {
			val := g.generateUUID()
			assert.NotNil(t, val)
		}
	})

	t.Run("malicious profile produces UUID or boundary variant", func(t *testing.T) {
		g := New(nil, swagger.ProfileMalicious, swagger.Settings{})
		for range 10 {
			val := g.generateUUID()
			assert.NotNil(t, val)
		}
	})
}

func TestStringGen_OOBURL(t *testing.T) {
	t.Parallel()

	t.Run("default localhost baseURL without run ID", func(t *testing.T) {
		g := &Generator{}
		url := g.oobURL("uuid-1234")
		assert.Equal(t, "http://localhost:8080/api/oob/uuid-1234", url)
	})

	t.Run("custom host without scheme and without api/oob", func(t *testing.T) {
		g := &Generator{oobServerURL: "interact.sh:443"}
		url := g.oobURL("uuid-1234")
		assert.Equal(t, "http://interact.sh:443/api/oob/uuid-1234", url)
	})

	t.Run("custom https host with api/oob and run ID", func(t *testing.T) {
		g := &Generator{
			oobServerURL: "https://oob.example.com/api/oob/",
			RunID:        "run-sess-99",
		}
		url := g.oobURL("uuid-5678")
		assert.Equal(t, "https://oob.example.com/api/oob/run-sess-99/uuid-5678", url)
	})
}

func TestStringGen_RandomizeAndRegisterSSTI(t *testing.T) {
	t.Parallel()

	g := &Generator{}

	t.Run("ssti multiplication expression 7*7", func(t *testing.T) {
		input := "payload_{{7*7}}_test"
		out := g.randomizeAndRegisterSSTI(input)
		assert.NotContains(t, out, "{{7*7}}")
		assert.True(t, strings.HasPrefix(out, "payload_{{"))
		assert.True(t, strings.HasSuffix(out, "}}_test"))

		ctx, found := sstistore.GlobalStore.Get(out)
		require.True(t, found)
		assert.NotEmpty(t, ctx.RawExpr)
		assert.NotEmpty(t, ctx.Expected)
	})

	t.Run("ssti string concatenation 7+'7'", func(t *testing.T) {
		input := "expr_${7+'7'}_tail"
		out := g.randomizeAndRegisterSSTI(input)
		assert.NotContains(t, out, "${7+'7'}")
		assert.True(t, strings.HasPrefix(out, "expr_${"))
		assert.True(t, strings.HasSuffix(out, "}_tail"))

		ctx, found := sstistore.GlobalStore.Get(out)
		require.True(t, found)
		assert.NotEmpty(t, ctx.RawExpr)
		assert.NotEmpty(t, ctx.Expected)
	})

	t.Run("string without ssti patterns returns unchanged", func(t *testing.T) {
		input := "just a regular string"
		out := g.randomizeAndRegisterSSTI(input)
		assert.Equal(t, input, out)
	})
}
