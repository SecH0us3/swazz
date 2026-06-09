package swagger

import (
	"encoding/json"
	"testing"
)

func TestParseSpec_OpenAPI3(t *testing.T) {
	specRaw := `{
		"openapi": "3.0.0",
		"info": {
			"title": "Test API",
			"version": "1.0.0"
		},
		"servers": [
			{ "url": "https://api.example.com/v1" }
		],
		"paths": {
			"/users": {
				"post": {
					"requestBody": {
						"content": {
							"application/json": {
								"schema": {
									"type": "object",
									"properties": {
										"name": { "type": "string" }
									}
								}
							}
						}
					}
				}
			},
			"/users/{id}": {
				"get": {
					"parameters": [
						{
							"name": "id",
							"in": "path",
							"required": true,
							"schema": { "type": "integer" }
						},
						{
							"name": "X-Auth",
							"in": "header",
							"schema": { "type": "string" }
						}
					]
				}
			}
		}
	}`

	result, err := ParseSpec(json.RawMessage(specRaw))
	if err != nil {
		t.Fatalf("Failed to parse spec: %v", err)
	}

	if result.BasePath != "https://api.example.com/v1" {
		t.Errorf("Expected BasePath 'https://api.example.com/v1', got '%s'", result.BasePath)
	}

	if len(result.Endpoints) != 2 {
		t.Fatalf("Expected 2 endpoints, got %d", len(result.Endpoints))
	}

	// Verify POST /users
	var postEndpoint *EndpointConfig
	var getEndpoint *EndpointConfig
	for i, ep := range result.Endpoints {
		if ep.Method == "POST" && ep.Path == "/users" {
			postEndpoint = &result.Endpoints[i]
		}
		if ep.Method == "GET" && ep.Path == "/users/{id}" {
			getEndpoint = &result.Endpoints[i]
		}
	}

	if postEndpoint == nil || getEndpoint == nil {
		t.Fatalf("Did not find expected endpoints")
	}

	if postEndpoint.Schema.Type != "object" {
		t.Errorf("Expected POST /users to have object schema, got %s", postEndpoint.Schema.Type)
	}

	if len(getEndpoint.PathParams) != 1 {
		t.Errorf("Expected 1 path parameter for GET /users/{id}")
	}

	if len(getEndpoint.HeaderParams) != 1 {
		t.Errorf("Expected 1 header parameter for GET /users/{id}")
	}
}

func TestParseSpec_Swagger2(t *testing.T) {
	specRaw := `{
		"swagger": "2.0",
		"host": "api.example.com",
		"basePath": "/v2",
		"schemes": ["https"],
		"paths": {
			"/ping": {
				"get": {
					"responses": {
						"200": {
							"description": "OK"
						}
					}
				}
			}
		}
	}`

	result, err := ParseSpec(json.RawMessage(specRaw))
	if err != nil {
		t.Fatalf("Failed to parse spec: %v", err)
	}

	expectedBase := "https://api.example.com/v2"
	if result.BasePath != expectedBase {
		t.Errorf("Expected BasePath '%s', got '%s'", expectedBase, result.BasePath)
	}

	if len(result.Endpoints) != 1 {
		t.Fatalf("Expected 1 endpoint, got %d", len(result.Endpoints))
	}

	if result.Endpoints[0].Path != "/ping" || result.Endpoints[0].Method != "GET" {
		t.Errorf("Expected GET /ping")
	}
}

func TestParseSpec_Invalid(t *testing.T) {
	_, err := ParseSpec(json.RawMessage(`{}`))
	if err == nil {
		t.Errorf("Expected error when parsing empty object")
	}

	_, err = ParseSpec(json.RawMessage(`invalid json`))
	if err == nil {
		t.Errorf("Expected error when parsing invalid json")
	}
}

func TestDetermineBasePath(t *testing.T) {
	tests := []struct {
		name     string
		spec     map[string]any
		expected string
	}{
		{
			name: "OpenAPI 3.x valid server",
			spec: map[string]any{
				"openapi": "3.0.0",
				"servers": []any{
					map[string]any{
						"url": "https://api.example.com/v1",
					},
				},
			},
			expected: "https://api.example.com/v1",
		},
		{
			name: "OpenAPI 3.x no servers",
			spec: map[string]any{
				"openapi": "3.0.0",
			},
			expected: "",
		},
		{
			name: "Swagger 2.0 full",
			spec: map[string]any{
				"swagger":  "2.0",
				"schemes":  []any{"http"},
				"host":     "api.example.com",
				"basePath": "/v2",
			},
			expected: "http://api.example.com/v2",
		},
		{
			name: "Swagger 2.0 default scheme",
			spec: map[string]any{
				"swagger":  "2.0",
				"host":     "api.example.com",
				"basePath": "/v2",
			},
			expected: "https://api.example.com/v2",
		},
		{
			name: "Swagger 2.0 no host",
			spec: map[string]any{
				"swagger":  "2.0",
				"basePath": "/v2",
			},
			expected: "/v2",
		},
		{
			name: "Unknown spec",
			spec: map[string]any{
				"unknown": "1.0",
			},
			expected: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := determineBasePath(tt.spec)
			if actual != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, actual)
			}
		})
	}
}

func TestParseRawSpec(t *testing.T) {
	t.Run("Valid YAML OpenAPI Spec", func(t *testing.T) {
		yamlSpec := `
openapi: 3.0.0
info:
  title: Test YAML API
  version: 1.0.0
servers:
  - url: https://api.example.com/v1
paths:
  /ping:
    get:
      summary: Ping the server
`
		result, err := ParseRawSpec([]byte(yamlSpec))
		if err != nil {
			t.Fatalf("Failed to parse YAML spec: %v", err)
		}

		if result.BasePath != "https://api.example.com/v1" {
			t.Errorf("Expected BasePath 'https://api.example.com/v1', got '%s'", result.BasePath)
		}

		if len(result.Endpoints) != 1 {
			t.Fatalf("Expected 1 endpoint, got %d", len(result.Endpoints))
		}

		if result.Endpoints[0].Path != "/ping" || result.Endpoints[0].Method != "GET" {
			t.Errorf("Expected GET /ping")
		}
	})

	t.Run("Valid JSON OpenAPI Spec", func(t *testing.T) {
		jsonSpec := `
{
  "openapi": "3.0.0",
  "info": {
    "title": "Test JSON API",
    "version": "1.0.0"
  },
  "servers": [
    {"url": "https://api.example.com/v2"}
  ],
  "paths": {
    "/ping": {
      "get": {
        "summary": "Ping the server"
      }
    }
  }
}
`
		result, err := ParseRawSpec([]byte(jsonSpec))
		if err != nil {
			t.Fatalf("Failed to parse JSON spec: %v", err)
		}

		if result.BasePath != "https://api.example.com/v2" {
			t.Errorf("Expected BasePath 'https://api.example.com/v2', got '%s'", result.BasePath)
		}

		if len(result.Endpoints) != 1 {
			t.Fatalf("Expected 1 endpoint, got %d", len(result.Endpoints))
		}
	})

	t.Run("Invalid YAML Spec", func(t *testing.T) {
		invalidYaml := `
foo: bar: baz
`
		_, err := ParseRawSpec([]byte(invalidYaml))
		if err == nil {
			t.Error("expected error for invalid YAML, got nil")
		}
	})

	t.Run("Invalid JSON Spec", func(t *testing.T) {
		invalidJson := `
{ "invalid": "json",
`
		_, err := ParseRawSpec([]byte(invalidJson))
		if err == nil {
			t.Error("expected error for invalid JSON, got nil")
		}
	})
}
