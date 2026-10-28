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

// encodedSizeBounds brackets the length of v's JSON encoding: lo must never exceed the encoded
// length, and hi must never fall below it.
func TestEncodedSizeBounds(t *testing.T) {
	cases := []any{
		"",
		strings.Repeat("A", 1000),
		`quotes " and \ backslashes <script>&`,
		"multi-byte あ🔥",
		map[string]any{},
		map[string]any(nil),
		[]any(nil),
		[]string(nil),
		map[string]string(nil),
		map[string]any{"": []any{map[string]any(nil), []string(nil), []any(nil), map[string]string(nil)}},
		map[string]any{"body": map[string]any{"name": "x", "tags": []any{"a", "b", 1, nil, true}}},
		map[string]any{"queryParams": map[string]any{"q": 1.5, "s": "v"}, "pathParams": map[string]string{"id": "42", "x": ""}},
		[]any{},
		[]any{map[string]any{"k": []any{}}, "z"},
		[]string{"a", "<b\xff>", "\u2028"},
		map[string]string{},
		nil,
		42,
		-1.2345678901234567e-6,
	}
	for _, v := range cases {
		encoded, err := json.Marshal(v)
		require.NoError(t, err)
		lo, hi := encodedSizeBounds(v, 1<<30)
		assert.LessOrEqual(t, lo, len(encoded), "lo > len(encoded) for %#v", v)
		assert.GreaterOrEqual(t, hi, len(encoded), "hi < len(encoded) for %#v", v)
	}

	// Over the cap: decided without encoding.
	big := map[string]any{"body": map[string]any{"a": strings.Repeat("A", 2000), "b": strings.Repeat("B", 2000)}}
	lo, _ := encodedSizeBounds(big, 1000)
	assert.Greater(t, lo, 1000)
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
		{body: map[string]any{"html": strings.Repeat("<>&", 20)}},
		{body: map[string]any{"invalidUTF8": strings.Repeat("\xff\xfe\x80", 15)}},
		{body: map[string]any{"lineSep": strings.Repeat("\u2028\u2029", 15)}},
		{body: map[string]any{"ctrl": "\x00\x01\x1f\"\\\b\f\n\r\t"}},
		{
			pathParams: map[string]string{
				"<key\xff\u2028>": "<val\xff\u2029>",
			},
		},
		{
			body: map[string]any{
				"minInt64":  int64(math.MinInt64),
				"maxInt64":  int64(math.MaxInt64),
				"maxUint64": uint64(math.MaxUint64),
				"boolTrue":  true,
				"boolFalse": false,
				"nilVal":    nil,
			},
		},
		{
			body: map[string]any{
				"maxFloat64":  math.MaxFloat64,
				"negMaxFloat": -math.MaxFloat64,
				"smallest":    math.SmallestNonzeroFloat64,
				"negSmallest": -math.SmallestNonzeroFloat64,
				"longFixed":   -1.2345678901234567e-6,
				"maxFloat32":  float32(math.MaxFloat32),
			},
		},
		{body: map[string]any{"inf": math.Inf(1)}},
		{body: map[string]any{"negInf": math.Inf(-1)}},
		{body: map[string]any{"nan": math.NaN()}},
		{body: map[string]any{"inf32": float32(math.Inf(1))}},
		{body: map[string]any{"nan32": float32(math.NaN())}},
		{body: map[string]any{"customSlice": []string{"a", "<b\xff>", "\u2028c"}}},
		{body: map[string]any{"": []any{map[string]any(nil), []string(nil), []any(nil), map[string]string(nil)}}},
		{
			body:        map[string]any{"a": strings.Repeat("A", 120)},
			pathParams:  map[string]string{"p": strings.Repeat("<", 30)},
			queryParams: map[string]any{"q": []any{strings.Repeat("\xff", 20), int64(math.MinInt64)}},
		},
	}

	for i, tc := range testCases {
		lo, hi := payloadEncodedBounds(tc, 1<<30)
		assert.LessOrEqual(t, lo, hi, "case %d lo > hi", i)

		for capBytes := 0; capBytes <= 600; capBytes++ {
			expectedHash, expectedFits := referenceSizedPayloadHash(tc, capBytes)
			actualHash, actualFits := sizedPayloadHash(tc, capBytes)
			require.Equal(t, expectedFits, actualFits, "case %d cap %d sizedPayloadHash fits mismatch", i, capBytes)
			require.Equal(t, expectedHash, actualHash, "case %d cap %d hash mismatch", i, capBytes)
			require.Equal(t, expectedFits, payloadFits(tc, capBytes), "case %d cap %d payloadFits mismatch", i, capBytes)
		}
	}
}
