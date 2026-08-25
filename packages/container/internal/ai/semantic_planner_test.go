// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/swagger"
)

func TestSemanticPlanner_ExtractSemanticFormats(t *testing.T) {
	planner := NewSemanticPlanner("http://localhost:8080", "test-cf-token", "test-key")
	cfg := &swagger.Config{
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/users",
				Method: "POST",
				QueryParams: map[string]*swagger.SchemaProperty{
					"email": {Type: "string", Format: "email"},
				},
				PathParams: map[string]*swagger.SchemaProperty{
					"user_uuid": {Type: "string", Format: "uuid"},
				},
			},
		},
	}
	formats := planner.ExtractSemanticFormats(cfg)
	if formats == nil {
		t.Fatalf("expected non-nil format map")
	}
	if formats["email"] != "email" {
		t.Errorf("expected email format to be 'email', got %s", formats["email"])
	}
	if formats["user_uuid"] != "uuid" {
		t.Errorf("expected user_uuid format to be 'uuid', got %s", formats["user_uuid"])
	}
}

func TestParseGatewayError(t *testing.T) {
	// 1. Array format error
	errArray := []byte(`{"error": [{"message": "rate limit exceeded"}]}`)
	err := parseGatewayError(429, errArray)
	if err == nil || err.Error() != "AI Gateway error 429: rate limit exceeded" {
		t.Errorf("unexpected error message: %v", err)
	}

	// 2. Object format error
	errObj := []byte(`{"error": {"message": "invalid api key"}}`)
	err = parseGatewayError(401, errObj)
	if err == nil || err.Error() != "AI Gateway error 401: invalid api key" {
		t.Errorf("unexpected error message: %v", err)
	}

	// 3. Raw string error
	errRaw := []byte(`Internal Server Error`)
	err = parseGatewayError(500, errRaw)
	if err == nil || err.Error() != "AI Gateway error 500: Internal Server Error" {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestParseGatewayResponse(t *testing.T) {
	// 1. Gemini format
	geminiResp := []byte(`{
		"candidates": [{
			"content": {
				"parts": [{
					"text": "[\"admin' OR 1=1--\", \"<script>alert(1)</script>\"]"
				}]
			}
		}]
	}`)
	payloads, err := parseGatewayResponse(geminiResp, true)
	if err != nil {
		t.Fatalf("unexpected error parsing gemini response: %v", err)
	}
	if len(payloads) != 2 {
		t.Fatalf("expected 2 payloads, got %d", len(payloads))
	}

	// 2. OpenAI format
	openAIResp := []byte(`{
		"choices": [{
			"message": {
				"content": "[\"{{7*7}}\", \"../../../etc/passwd\"]"
			}
		}]
	}`)
	payloadsOA, err := parseGatewayResponse(openAIResp, false)
	if err != nil {
		t.Fatalf("unexpected error parsing openai response: %v", err)
	}
	if len(payloadsOA) != 2 {
		t.Fatalf("expected 2 payloads, got %d", len(payloadsOA))
	}

	// 3. Invalid JSON
	_, err = parseGatewayResponse([]byte(`{invalid`), false)
	if err == nil {
		t.Errorf("expected error on invalid JSON")
	}
}

func TestSemanticPlanner_GeneratePreScanPayloads(t *testing.T) {
	// 1. Success with OpenAI format
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"choices": [{
				"message": {
					"content": "[\"test_payload_1\", \"test_payload_2\"]"
				}
			}]
		}`))
	}))
	defer ts.Close()

	planner := NewSemanticPlanner(ts.URL, "cf-token", "key")
	payloads, err := planner.GeneratePreScanPayloads(context.Background(), "title: Test API")
	require.NoError(t, err)
	assert.Len(t, payloads, 2)
	assert.Equal(t, "test_payload_1", payloads[0])

	// 2. Empty gateway URL
	emptyPlanner := NewSemanticPlanner("", "", "")
	_, err = emptyPlanner.GeneratePreScanPayloads(context.Background(), "schema")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "ai_gateway_url is empty")

	// 3. Error response from Gateway
	errTS := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":{"message":"gateway offline"}}`))
	}))
	defer errTS.Close()

	errPlanner := NewSemanticPlanner(errTS.URL, "token", "key")
	_, err = errPlanner.GeneratePreScanPayloads(context.Background(), "schema")
	assert.Error(t, err)
}

func TestSemanticPlanner_ExtractSemanticFormats_All(t *testing.T) {
	planner := NewSemanticPlanner("http://localhost:8080", "token", "key")
	cfg := &swagger.Config{
		Endpoints: []swagger.EndpointConfig{
			{
				Path:   "/api/items",
				Method: "POST",
				HeaderParams: map[string]*swagger.SchemaProperty{
					"X-Trace-ID": {Type: "string", Format: "uuid"},
				},
				Schema: swagger.SchemaProperty{
					Properties: map[string]*swagger.SchemaProperty{
						"created_at": {Type: "string", Format: "date-time"},
						"website":    {Type: "string", Format: "uri"},
					},
				},
			},
		},
	}
	formats := planner.ExtractSemanticFormats(cfg)
	assert.Equal(t, "uuid", formats["X-Trace-ID"])
	assert.Equal(t, "date-time", formats["created_at"])
	assert.Equal(t, "uri", formats["website"])

	// nil config returns empty map
	assert.Empty(t, planner.ExtractSemanticFormats(nil))
}


