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
