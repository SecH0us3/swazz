// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ai

import (
	"testing"
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

