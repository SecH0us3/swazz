// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/generator/payloads"
	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildFuzzIteration_EnforcesMaxPayloadSize(t *testing.T) {
	r := &Runner{
		config: &swagger.Config{
			Settings: swagger.DefaultSettings(),
		},
	}

	endpoint := swagger.EndpointConfig{
		Path:   "/api/data",
		Method: "POST",
		Schema: swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"largeField": {Type: "string"},
			},
		},
	}

	gen := generator.New(nil, swagger.ProfileBoundary, r.config.Settings)
	safeGen := generator.New(nil, swagger.ProfileRandom, r.config.Settings)

	t.Run("payload size within small 500 byte limit", func(t *testing.T) {
		smallLimit := 500
		seenHashes := make(map[uint32]bool)

		built, _, isDuplicate := r.buildFuzzIteration(endpoint, gen, safeGen, false, smallLimit, false, seenHashes)
		if !isDuplicate && built.body != nil {
			bodyBytes, err := json.Marshal(built.body)
			require.NoError(t, err)
			assert.LessOrEqual(t, len(bodyBytes), smallLimit, "generated payload must not exceed maxPayloadSize")
		}
	})

	t.Run("payload size within 10MB default limit", func(t *testing.T) {
		limit := swagger.DefaultMaxPayloadSizeBytes
		seenHashes := make(map[uint32]bool)

		built, _, isDuplicate := r.buildFuzzIteration(endpoint, gen, safeGen, false, limit, false, seenHashes)
		assert.False(t, isDuplicate)
		require.NotNil(t, built.body)

		bodyBytes, err := json.Marshal(built.body)
		require.NoError(t, err)
		assert.LessOrEqual(t, len(bodyBytes), limit)
	})
}

// minEncodedSize decides, without encoding, that a payload is over the size cap; it may only do
// so when the real encoding is over it too, so it must never exceed the encoded length.
func TestMinEncodedSize_IsALowerBound(t *testing.T) {
	cases := []any{
		"",
		strings.Repeat("A", 1000),
		`quotes " and \ backslashes <script>&`,
		"multi-byte あ🔥",
		map[string]any{},
		map[string]any{"body": map[string]any{"name": "x", "tags": []any{"a", "b", 1, nil, true}}},
		map[string]any{"queryParams": map[string]any{"q": 1.5, "s": "v"}, "pathParams": map[string]string{"id": "42", "x": ""}},
		[]any{},
		[]any{map[string]any{"k": []any{}}, "z"},
		map[string]string{},
		nil,
		42,
	}
	for _, v := range cases {
		encoded, err := json.Marshal(v)
		require.NoError(t, err)
		assert.LessOrEqual(t, minEncodedSize(v, 1<<30), len(encoded), "%#v", v)
	}

	// Over the cap: decided without encoding.
	big := map[string]any{"body": map[string]any{"a": strings.Repeat("A", 2000), "b": strings.Repeat("B", 2000)}}
	assert.Greater(t, minEncodedSize(big, 1000), 1000)
}

// The size check is the same for both fuzz paths: an encoding over the cap does not fit, one at
// the cap does, and the hash is that of the encoding without the encoder's trailing newline.
func TestSizedPayloadHash(t *testing.T) {
	p := generatedPayload{body: map[string]any{"a": "xyz"}}
	encoded := `{"body":{"a":"xyz"}}`

	h, fits := sizedPayloadHash(p, len(encoded))
	assert.True(t, fits)
	assert.Equal(t, payloads.HashStr(encoded), h)

	_, fits = sizedPayloadHash(p, len(encoded)-1)
	assert.False(t, fits)

	big := generatedPayload{body: map[string]any{"a": strings.Repeat("A", 1<<20)}}
	_, fits = sizedPayloadHash(big, 1<<10)
	assert.False(t, fits)
}

func referenceSizedPayloadHash(p generatedPayload, maxBytes int) (uint32, bool) {
	payloadMap := make(map[string]any)
	if p.body != nil {
		payloadMap["body"] = p.body
	}
	if p.pathParams != nil {
		payloadMap["pathParams"] = p.pathParams
	}
	if p.queryParams != nil {
		payloadMap["queryParams"] = p.queryParams
	}
	b, err := json.Marshal(payloadMap)
	if err != nil || len(b) > maxBytes {
		return 0, false
	}
	return payloads.HashBytes(b), true
}

func TestSizedPayloadHash_Equivalence(t *testing.T) {
	testCases := []generatedPayload{
		{},
		{body: map[string]any{}},
		{pathParams: map[string]string{}},
		{queryParams: map[string]any{}},
		{body: map[string]any{"id": 123, "name": "test"}},
		{pathParams: map[string]string{"petId": "456", "tag": "abc"}},
		{queryParams: map[string]any{"limit": 10, "offset": 20}},
		{
			body:        map[string]any{"nested": map[string]any{"k": "v"}},
			pathParams:  map[string]string{"user": "alex"},
			queryParams: map[string]any{"debug": true},
		},
		{body: map[string]any{"inf": math.Inf(1)}},
		{body: map[string]any{"nan": math.NaN()}},
		{body: map[string]any{"customSlice": []string{"a", "b", "c"}}},
	}

	for i, tc := range testCases {
		expectedHash, expectedFits := referenceSizedPayloadHash(tc, 1<<20)
		actualHash, actualFits := sizedPayloadHash(tc, 1<<20)
		assert.Equal(t, expectedFits, actualFits, "case %d fits mismatch", i)
		assert.Equal(t, expectedHash, actualHash, "case %d hash mismatch", i)

		// Also verify payloadFits
		assert.Equal(t, expectedFits, payloadFits(tc, 1<<20), "case %d payloadFits mismatch", i)
	}
}
