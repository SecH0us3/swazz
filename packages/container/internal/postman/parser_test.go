package postman

import (
	"testing"
)

func TestParsePostman_Simple(t *testing.T) {
	collectionJSON := `{
		"info": {
			"name": "Test Collection",
			"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
		},
		"item": [
			{
				"name": "Get Users",
				"request": {
					"method": "GET",
					"header": [
						{
							"key": "X-Test-Header",
							"value": "TestValue"
						}
					],
					"url": {
						"raw": "https://api.example.com/v1/users/:userId?active=true",
						"protocol": "https",
						"host": [
							"api",
							"example",
							"com"
						],
						"path": [
							"v1",
							"users",
							":userId"
						],
						"query": [
							{
								"key": "active",
								"value": "true"
							}
						],
						"variable": [
							{
								"key": "userId",
								"value": "123"
							}
						]
					}
				}
			}
		]
	}`

	res, err := ParsePostman([]byte(collectionJSON))
	if err != nil {
		t.Fatalf("unexpected error parsing postman: %v", err)
	}

	if res.BasePath != "https://api.example.com" {
		t.Errorf("expected BasePath https://api.example.com, got %s", res.BasePath)
	}

	if len(res.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", len(res.Endpoints))
	}

	ep := res.Endpoints[0]
	if ep.Path != "/v1/users/{userId}" {
		t.Errorf("expected Path /v1/users/{userId}, got %s", ep.Path)
	}

	if ep.Method != "GET" {
		t.Errorf("expected method GET, got %s", ep.Method)
	}

	// Verify Header Params
	if _, ok := ep.HeaderParams["X-Test-Header"]; !ok {
		t.Error("expected X-Test-Header in HeaderParams")
	}

	// Verify Path Params
	if _, ok := ep.PathParams["userId"]; !ok {
		t.Error("expected userId in PathParams")
	}

	// Since method is GET and there's no body, schema should come from query parameters
	if ep.Schema.Type != "object" {
		t.Errorf("expected schema type object, got %s", ep.Schema.Type)
	}
	if _, ok := ep.Schema.Properties["active"]; !ok {
		t.Error("expected query parameter 'active' in schema properties")
	}
}

func TestParsePostman_JSONBodyAndNested(t *testing.T) {
	collectionJSON := `{
		"info": {
			"name": "Nested Test Collection",
			"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
		},
		"item": [
			{
				"name": "User Folder",
				"item": [
					{
						"name": "Create User",
						"request": {
							"method": "POST",
							"header": [
								{
									"key": "Content-Type",
									"value": "application/json"
								}
							],
							"body": {
								"mode": "raw",
								"raw": "{\"name\": \"Bob\", \"age\": 35, \"tags\": [\"admin\", \"vip\"], \"profile\": {\"bio\": \"Hello\"}}"
							},
							"url": "http://api.example.com/users"
						}
					}
				]
			}
		]
	}`

	res, err := ParsePostman([]byte(collectionJSON))
	if err != nil {
		t.Fatalf("unexpected error parsing postman: %v", err)
	}

	if len(res.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", len(res.Endpoints))
	}

	ep := res.Endpoints[0]
	if ep.Path != "/users" {
		t.Errorf("expected path /users, got %s", ep.Path)
	}
	if ep.Method != "POST" {
		t.Errorf("expected method POST, got %s", ep.Method)
	}
	if ep.ContentType != "application/json" {
		t.Errorf("expected content type application/json, got %s", ep.ContentType)
	}

	// Validate inferred body schema
	props := ep.Schema.Properties
	if props == nil {
		t.Fatal("expected non-nil schema properties")
	}

	nameProp, ok := props["name"]
	if !ok || nameProp.Type != "string" {
		t.Errorf("expected name property of type string, got %v", nameProp)
	}

	ageProp, ok := props["age"]
	if !ok || ageProp.Type != "integer" {
		t.Errorf("expected age property of type integer, got %v", ageProp)
	}

	tagsProp, ok := props["tags"]
	if !ok || tagsProp.Type != "array" || tagsProp.Items == nil || tagsProp.Items.Type != "string" {
		t.Errorf("expected tags array of strings, got %v", tagsProp)
	}

	profileProp, ok := props["profile"]
	if !ok || profileProp.Type != "object" || profileProp.Properties == nil {
		t.Errorf("expected profile nested object, got %v", profileProp)
	} else {
		bioProp, ok := profileProp.Properties["bio"]
		if !ok || bioProp.Type != "string" {
			t.Errorf("expected profile.bio string, got %v", bioProp)
		}
	}
}

func TestParsePostman_FormAndUrlEncoded(t *testing.T) {
	collectionJSON := `{
		"info": {
			"name": "Forms Collection",
			"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
		},
		"item": [
			{
				"name": "UrlEncoded Post",
				"request": {
					"method": "POST",
					"body": {
						"mode": "urlencoded",
						"urlencoded": [
							{"key": "username", "value": "alice"},
							{"key": "password", "value": "secret", "disabled": true},
							{"key": "role", "value": "user"}
						]
					},
					"url": "http://example.com/login"
				}
			},
			{
				"name": "FormData Post",
				"request": {
					"method": "POST",
					"body": {
						"mode": "formdata",
						"formdata": [
							{"key": "file", "type": "file"},
							{"key": "desc", "value": "text"}
						]
					},
					"url": "http://example.com/upload"
				}
			}
		]
	}`

	res, err := ParsePostman([]byte(collectionJSON))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(res.Endpoints) != 2 {
		t.Fatalf("expected 2 endpoints, got %d", len(res.Endpoints))
	}

	// 1. UrlEncoded
	ep1 := res.Endpoints[0]
	if ep1.ContentType != "application/x-www-form-urlencoded" {
		t.Errorf("expected application/x-www-form-urlencoded, got %s", ep1.ContentType)
	}
	if _, ok := ep1.Schema.Properties["username"]; !ok {
		t.Error("expected username in urlencoded schema properties")
	}
	if _, ok := ep1.Schema.Properties["password"]; ok {
		t.Error("password is disabled and should not be in properties")
	}

	// 2. FormData
	ep2 := res.Endpoints[1]
	if ep2.ContentType != "multipart/form-data" {
		t.Errorf("expected multipart/form-data, got %s", ep2.ContentType)
	}
	if _, ok := ep2.Schema.Properties["file"]; !ok {
		t.Error("expected file in formdata schema properties")
	}
}

func TestParsePostman_Invalid(t *testing.T) {
	_, err := ParsePostman([]byte(`{"invalid": "json"}`))
	if err == nil {
		t.Error("expected error for invalid Postman collection")
	}

	_, err = ParsePostman([]byte(`bad-json`))
	if err == nil {
		t.Error("expected error for malformed json")
	}
}

func TestParsePostman_EdgeCases(t *testing.T) {
	// 1. Path variables {{param}}, path params in Variable, double slashes, host/path as string
	collectionJSON := `{
		"info": {
			"name": "Edge Cases Collection",
			"schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
		},
		"item": [
			{
				"name": "Request 1",
				"request": {
					"method": "", 
					"header": [
						{
							"key": "Content-Type",
							"value": "application/json",
							"disabled": true
						},
						{
							"key": "X-Enabled",
							"value": "Yes"
						},
						{
							"key": "",
							"value": "Invalid"
						}
					],
					"body": {
						"mode": "raw",
						"raw": "invalid-json-body"
					},
					"url": {
						"raw": "http://api.example.com//v1//users/{{userId}}",
						"protocol": "http",
						"host": "api.example.com",
						"path": "v1/users/{{userId}}",
						"variable": [
							{
								"key": "userId",
								"value": "999"
							},
							{
								"key": "",
								"value": "empty-key"
							}
						]
					}
				}
			}
		]
	}`

	res, err := ParsePostman([]byte(collectionJSON))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", len(res.Endpoints))
	}
	ep := res.Endpoints[0]
	if ep.Method != "GET" {
		t.Errorf("expected default method GET, got %s", ep.Method)
	}
	if ep.Path != "/v1/users/{userId}" {
		t.Errorf("expected path /v1/users/{userId}, got %s", ep.Path)
	}
	if _, ok := ep.PathParams["userId"]; !ok {
		t.Error("expected userId in PathParams")
	}

	// 2. Unmarshal Host/Path as []any with non-strings, XML/JSON-array body inference, empty url, url as string
	collectionJSON2 := `{
		"info": {
			"name": "Edge Cases 2",
			"schema": "schema"
		},
		"item": [
			{
				"name": "XML Request",
				"request": {
					"method": "POST",
					"body": {
						"mode": "raw",
						"raw": "  <xml>hello</xml> "
					},
					"url": {
						"host": ["api", 123, "com"],
						"path": ["v1", 456, "users"]
					}
				}
			},
			{
				"name": "Plain Text Request",
				"request": {
					"method": "POST",
					"body": {
						"mode": "raw",
						"raw": "plain text"
					},
					"url": "http://example.com/plain"
				}
			},
			{
				"name": "Nil URL Request",
				"request": {
					"method": "PUT"
				}
			},
			{
				"name": "JSON Array Request",
				"request": {
					"method": "POST",
					"body": {
						"mode": "raw",
						"raw": "[{\"id\": 1}]"
					},
					"url": "http://example.com/array"
				}
			}
		]
	}`
	res2, err := ParsePostman([]byte(collectionJSON2))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res2.Endpoints) != 4 {
		t.Fatalf("expected 4 endpoints, got %d", len(res2.Endpoints))
	}
	if res2.Endpoints[0].ContentType != "application/xml" {
		t.Errorf("expected application/xml, got %s", res2.Endpoints[0].ContentType)
	}
	if res2.Endpoints[1].ContentType != "text/plain" {
		t.Errorf("expected text/plain, got %s", res2.Endpoints[1].ContentType)
	}
	if res2.Endpoints[2].Path != "/" {
		t.Errorf("expected /, got %s", res2.Endpoints[2].Path)
	}
	if res2.Endpoints[3].ContentType != "application/json" {
		t.Errorf("expected application/json, got %s", res2.Endpoints[3].ContentType)
	}
	if res2.Endpoints[3].Schema.Type != "array" {
		t.Errorf("expected array schema, got %s", res2.Endpoints[3].Schema.Type)
	}

	// 3. determineBasePath fallback, no host in URL
	collectionJSON3 := `{
		"info": {
			"name": "Base Path Cases",
			"schema": "schema"
		},
		"item": [
			{
				"name": "Req",
				"request": {
					"url": {
						"raw": "/local/path"
					}
				}
			}
		]
	}`
	res3, err := ParsePostman([]byte(collectionJSON3))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res3.BasePath != "" {
		t.Errorf("expected empty base path, got %s", res3.BasePath)
	}

	// 4. determineBasePath URL.Raw is invalid
	collectionJSON4 := `{
		"info": {
			"name": "Invalid Raw URL",
			"schema": "schema"
		},
		"item": [
			{
				"name": "Req",
				"request": {
					"url": {
						"raw": "http://[::1]:namedport/path"
					}
				}
			}
		]
	}`
	res4, err := ParsePostman([]byte(collectionJSON4))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res4.BasePath != "" {
		t.Errorf("expected empty base path, got %s", res4.BasePath)
	}

	// 5. Empty collections
	_, err = ParsePostman([]byte(`{"info": {}}`))
	if err == nil {
		t.Error("expected error for empty name and items")
	}

	// 6. BasePath from host and protocol only (no raw url)
	collectionJSON5 := `{
		"info": { "name": "Test", "schema": "schema" },
		"item": [
			{
				"name": "Req",
				"request": {
					"url": {
						"protocol": "https",
						"host": ["api", "example", "org"]
					}
				}
			}
		]
	}`
	res5, err := ParsePostman([]byte(collectionJSON5))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res5.BasePath != "https://api.example.org" {
		t.Errorf("expected BasePath https://api.example.org, got %s", res5.BasePath)
	}

	// 7. Empty and disabled keys in query parameters, urlencoded, and formdata
	collectionJSON7 := `{
		"info": { "name": "Test 7", "schema": "schema" },
		"item": [
			{
				"name": "Query Param Edge Cases",
				"request": {
					"method": "GET",
					"url": {
						"raw": "http://example.com/query",
						"query": [
							{"key": "", "value": "val"},
							{"key": "enabled", "value": "yes"},
							{"key": "disabled", "value": "no", "disabled": true}
						]
					}
				}
			},
			{
				"name": "URLEncoded Edge Cases",
				"request": {
					"method": "POST",
					"body": {
						"mode": "urlencoded",
						"urlencoded": [
							{"key": "", "value": "val"},
							{"key": "enabled", "value": "yes"},
							{"key": "disabled", "value": "no", "disabled": true}
						]
					}
				}
			},
			{
				"name": "FormData Edge Cases",
				"request": {
					"method": "POST",
					"body": {
						"mode": "formdata",
						"formdata": [
							{"key": "", "value": "val"},
							{"key": "enabled", "value": "yes"},
							{"key": "disabled", "value": "no", "disabled": true}
						]
					}
				}
			}
		]
	}`
	res7, err := ParsePostman([]byte(collectionJSON7))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(res7.Endpoints) != 3 {
		t.Fatalf("expected 3 endpoints, got %d", len(res7.Endpoints))
	}
	// Verify query param schema
	qProps := res7.Endpoints[0].Schema.Properties
	if _, ok := qProps["enabled"]; !ok {
		t.Error("expected 'enabled' in query schema")
	}
	if _, ok := qProps[""]; ok {
		t.Error("did not expect empty key in query schema")
	}
	if _, ok := qProps["disabled"]; ok {
		t.Error("did not expect disabled key in query schema")
	}

	// Verify urlencoded schema
	uProps := res7.Endpoints[1].Schema.Properties
	if _, ok := uProps["enabled"]; !ok {
		t.Error("expected 'enabled' in urlencoded schema")
	}
	if _, ok := uProps[""]; ok {
		t.Error("did not expect empty key in urlencoded schema")
	}
	if _, ok := uProps["disabled"]; ok {
		t.Error("did not expect disabled key in urlencoded schema")
	}

	// Verify formdata schema
	fProps := res7.Endpoints[2].Schema.Properties
	if _, ok := fProps["enabled"]; !ok {
		t.Error("expected 'enabled' in formdata schema")
	}
	if _, ok := fProps[""]; ok {
		t.Error("did not expect empty key in formdata schema")
	}
	if _, ok := fProps["disabled"]; ok {
		t.Error("did not expect disabled key in formdata schema")
	}
}

func TestURLWrapper_UnmarshalJSON_Edge(t *testing.T) {
	var u URLWrapper
	err := u.UnmarshalJSON([]byte{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if u.Raw != "" {
		t.Errorf("expected empty Raw, got %s", u.Raw)
	}

	err = u.UnmarshalJSON([]byte(`"http://example.com"`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if u.Raw != "http://example.com" {
		t.Errorf("expected http://example.com, got %s", u.Raw)
	}

	err = u.UnmarshalJSON([]byte(`"`))
	if err == nil {
		t.Error("expected error for malformed string JSON")
	}

	err = u.UnmarshalJSON([]byte(`{"host": {`))
	if err == nil {
		t.Error("expected error for malformed URLWrapper JSON")
	}

	var u2 URLWrapper
	err = u2.UnmarshalJSON([]byte(`{"host": true, "path": 123}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestInferSchema_EdgeCases(t *testing.T) {
	// float64 (non-integer)
	s := inferSchema(3.14)
	if s == nil || s.Type != "number" {
		t.Errorf("expected number, got %v", s)
	}

	// bool
	s = inferSchema(true)
	if s == nil || s.Type != "boolean" {
		t.Errorf("expected boolean, got %v", s)
	}

	// empty array
	s = inferSchema([]any{})
	if s == nil || s.Type != "array" || s.Items == nil || s.Items.Type != "string" {
		t.Errorf("expected array of string, got %v", s)
	}

	// nil
	s = inferSchema(nil)
	if s != nil {
		t.Errorf("expected nil, got %v", s)
	}

	// unsupported type (int)
	s = inferSchema(int(123))
	if s == nil || s.Type != "string" {
		t.Errorf("expected string for unsupported type, got %v", s)
	}
}
