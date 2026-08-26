// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"net/http"
	"strings"
	"testing"

	"swazz-engine/internal/generator"
	"swazz-engine/internal/swagger"
	"github.com/stretchr/testify/assert"
)

func TestCapPathParam(t *testing.T) {
	// Under limit
	assert.Equal(t, "short-val", capPathParam("short-val"))

	// Over limit (256 chars)
	longVal := strings.Repeat("a", 300)
	capped := capPathParam(longVal)
	assert.Equal(t, 256, len(capped))
	assert.Equal(t, strings.Repeat("a", 256), capped)

	// Non-string type
	assert.Equal(t, "12345", capPathParam(12345))
}

func TestFillPathParams(t *testing.T) {
	gen := generator.New(nil, swagger.ProfileRandom, swagger.Settings{})

	// Path with no parameters
	assert.Equal(t, "/api/goods", fillPathParams("/api/goods", nil, gen))

	// Path with parameters defined in pathParams
	pathParams := map[string]*swagger.SchemaProperty{
		"id": {Type: "string"},
	}
	res := fillPathParams("/api/goods/{id}", pathParams, gen)
	assert.NotContains(t, res, "{id}")
	assert.Contains(t, res, "/api/goods/")

	// Path with remaining parameter not in pathParams (fallback)
	res = fillPathParams("/api/goods/{id}/{category}", pathParams, gen)
	assert.NotContains(t, res, "{id}")
	assert.NotContains(t, res, "{category}")

	// Double brace variable substitution should NOT be touched
	assert.Equal(t, "/api/goods/{{id}}", fillPathParams("/api/goods/{{id}}", nil, gen))
}

func TestFillPathParamsFromMap(t *testing.T) {
	// Path with no params
	assert.Equal(t, "/api/goods", fillPathParamsFromMap("/api/goods", nil))

	// Path with params in map
	params := map[string]string{
		"id": "123",
	}
	assert.Equal(t, "/api/goods/123", fillPathParamsFromMap("/api/goods/{id}", params))

	// Path with param not in map (fallback generator)
	res := fillPathParamsFromMap("/api/goods/{id}/{category}", params)
	assert.Contains(t, res, "/api/goods/123/")
	assert.NotContains(t, res, "{category}")

	// Double brace should NOT be replaced
	assert.Equal(t, "/api/goods/{{id}}", fillPathParamsFromMap("/api/goods/{{id}}", nil))
}

func TestMergePayload(t *testing.T) {
	assert.Equal(t, "body_payload", mergePayload("body_payload", map[string]any{"qp": 1}))
	assert.Equal(t, map[string]any{"qp": 1}, mergePayload(nil, map[string]any{"qp": 1}))
}

func TestPreviewAnyAndTruncateValue(t *testing.T) {
	// Nil value
	assert.Equal(t, "", previewAny(nil, 10))

	// Primitive types (short vs long)
	assert.Equal(t, `"abc"`, previewAny("abc", 5))
	assert.Equal(t, `"abcd... [truncated 1 chars]"`, previewAny("abcde", 4))

	// Bytes array (under vs over limit)
	assert.Equal(t, `"hello"`, previewAny([]byte("hello"), 10))
	assert.Equal(t, "\"\\u003craw data: 12 bytes (truncated)\\u003e\"", previewAny([]byte("hello-longer"), 5))

	// Arrays/Slices truncation (len <= 2 vs len > 2)
	assert.Equal(t, `[1,2]`, previewAny([]any{1, 2}, 10))
	assert.Equal(t, `[1,2,"... and 3 more elements"]`, previewAny([]any{1, 2, 3, 4, 5}, 10))

	// Map key truncation
	largeMap := make(map[string]any)
	for i := 0; i < 55; i++ {
		largeMap[string(rune('a'+i))] = i
	}
	preview := previewAny(largeMap, 20)
	assert.Contains(t, preview, "... (truncated keys)")
}

func TestToSSE(t *testing.T) {
	// Long resolved path truncation
	longPath := "/api/" + strings.Repeat("a", 210)
	result := &swagger.FuzzResult{
		ID:           "test-id",
		ResolvedPath: longPath,
		Method:       "GET",
		ResponseSize: 150,
	}
	sse := ToSSE(result)
	assert.Equal(t, 203, len(sse.ResolvedPath)) // 200 + 3-byte '…' symbol
	assert.True(t, strings.HasSuffix(sse.ResolvedPath, "…"))

	// Evidence and message truncation in findings
	resultWithFinding := &swagger.FuzzResult{
		ID: "test-id",
		AnalyzerFindings: []swagger.AnalysisFinding{
			{
				RuleID:   "swazz/sql-injection",
				Evidence: strings.Repeat("x", 1200),
				Message:  strings.Repeat("y", 1200),
			},
		},
	}
	sseFinding := ToSSE(resultWithFinding)
	assert.Equal(t, 1000+len("… [truncated]"), len(sseFinding.AnalyzerFindings[0].Evidence))
	assert.True(t, strings.HasSuffix(sseFinding.AnalyzerFindings[0].Evidence, "… [truncated]"))

	// Request/Response Headers mapping and truncation
	headersResult := &swagger.FuzzResult{
		ID: "test-id",
		AnalyzerFindings: []swagger.AnalysisFinding{
			{RuleID: "swazz/crlf-injection"},
		},
		RequestHeaders: map[string]string{
			"X-Long-Header-Name-" + strings.Repeat("h", 200): "Value-" + strings.Repeat("v", 1100),
		},
		ResponseHeaders: http.Header{
			"X-Resp-Header": []string{"Value-" + strings.Repeat("r", 1100)},
		},
	}
	sseHeaders := ToSSE(headersResult)
	// Check request header name truncation
	for k, v := range sseHeaders.RequestHeaders {
		assert.Equal(t, 203, len(k))
		assert.True(t, strings.HasSuffix(k, "…"))
		assert.True(t, strings.HasSuffix(v, "… [truncated]"))
	}
	// Check response header value truncation
	for _, vs := range sseHeaders.ResponseHeaders {
		assert.True(t, strings.HasSuffix(vs[0], "… [truncated]"))
	}
}

func TestToString(t *testing.T) {
	tests := []struct {
		name     string
		input    any
		expected string
	}{
		{"nil", nil, ""},
		{"string", "hello", "hello"},
		{"int", 123, "123"},
		{"int64", int64(456), "456"},
		{"float64", 3.1415, "3.1415"},
		{"bool true", true, "true"},
		{"bool false", false, "false"},
		{"custom struct", struct{ A int }{A: 1}, "{1}"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := toString(tt.input)
			if got != tt.expected {
				t.Errorf("toString(%v) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
