package graphql

import (
	"strings"
	"testing"
)

func TestParseGraphQLIntrospection(t *testing.T) {
	// A simple introspection response JSON string
	mockJSON := `{
  "data": {
    "__schema": {
      "queryType": {
        "name": "Query"
      },
      "mutationType": {
        "name": "Mutation"
      },
      "types": [
        {
          "kind": "OBJECT",
          "name": "Query",
          "fields": [
            {
              "name": "user",
              "args": [
                {
                  "name": "id",
                  "type": {
                    "kind": "NON_NULL",
                    "ofType": {
                      "kind": "SCALAR",
                      "name": "ID"
                    }
                  }
                }
              ],
              "type": {
                "kind": "OBJECT",
                "name": "User"
              }
            }
          ]
        },
        {
          "kind": "OBJECT",
          "name": "Mutation",
          "fields": [
            {
              "name": "createUser",
              "args": [
                {
                  "name": "username",
                  "type": {
                    "kind": "NON_NULL",
                    "ofType": {
                      "kind": "SCALAR",
                      "name": "String"
                    }
                  }
                }
              ],
              "type": {
                "kind": "OBJECT",
                "name": "User"
              }
            }
          ]
        },
        {
          "kind": "OBJECT",
          "name": "User",
          "fields": [
            {
              "name": "id",
              "type": {
                "kind": "SCALAR",
                "name": "ID"
              }
            },
            {
              "name": "name",
              "type": {
                "kind": "SCALAR",
                "name": "String"
              }
            }
          ]
        }
      ]
    }
  }
}`

	parsed, err := ParseGraphQLIntrospection([]byte(mockJSON), "/api/graphql")
	if err != nil {
		t.Fatalf("unexpected error parsing mock graphql schema: %v", err)
	}

	if len(parsed.Endpoints) != 2 {
		t.Fatalf("expected 2 endpoints, got %d", len(parsed.Endpoints))
	}

	// Verify query endpoint
	qEp := parsed.Endpoints[0]
	if qEp.Path != "/api/graphql?query=user" {
		t.Errorf("expected path /api/graphql?query=user, got %s", qEp.Path)
	}
	if qEp.Method != "POST" {
		t.Errorf("expected POST method, got %s", qEp.Method)
	}
	if qEp.ContentType != "application/json" {
		t.Errorf("expected application/json content type, got %s", qEp.ContentType)
	}

	// Verify query schema properties
	queryProp, ok := qEp.Schema.Properties["query"]
	if !ok {
		t.Fatalf("missing query property in schema")
	}
	if len(queryProp.Enum) != 1 {
		t.Fatalf("expected 1 enum value in query property, got %d", len(queryProp.Enum))
	}
	expectedQuery := "query user($id: ID!) { user(id: $id) { id name } }"
	if queryProp.Enum[0] != expectedQuery {
		t.Errorf("expected query '%s', got '%s'", expectedQuery, queryProp.Enum[0])
	}

	variablesProp, ok := qEp.Schema.Properties["variables"]
	if !ok {
		t.Fatalf("missing variables property in schema")
	}
	if variablesProp.Type != "object" {
		t.Errorf("expected variables type to be object, got %s", variablesProp.Type)
	}
	idProp, ok := variablesProp.Properties["id"]
	if !ok {
		t.Fatalf("missing id property in variables schema")
	}
	if idProp.Type != "string" {
		t.Errorf("expected id variable type string, got %s", idProp.Type)
	}
	if len(variablesProp.Required) != 1 || variablesProp.Required[0] != "id" {
		t.Errorf("expected required variables to contain 'id', got %v", variablesProp.Required)
	}

	// Verify mutation endpoint
	mEp := parsed.Endpoints[1]
	if mEp.Path != "/api/graphql?mutation=createUser" {
		t.Errorf("expected path /api/graphql?mutation=createUser, got %s", mEp.Path)
	}
}

func TestParseGraphQLIntrospection_FallbackAndErrors(t *testing.T) {
	// 1. Fallback JSON Parsing (without direct "data" wrapper)
	mockJSONDirect := `{
		"__schema": {
			"queryType": {
				"name": "Query"
			},
			"types": [
				{
					"kind": "OBJECT",
					"name": "Query",
					"fields": [
						{
							"name": "hello",
							"type": {
								"kind": "SCALAR",
								"name": "String"
							}
						}
					]
				}
			]
		}
	}`

	parsed, err := ParseGraphQLIntrospection([]byte(mockJSONDirect), "")
	if err != nil {
		t.Fatalf("unexpected error parsing direct schema: %v", err)
	}
	if len(parsed.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", len(parsed.Endpoints))
	}
	// Verify default path fallback to /graphql
	if parsed.Endpoints[0].Path != "/graphql?query=hello" {
		t.Errorf("expected default path to be /graphql?query=hello, got %s", parsed.Endpoints[0].Path)
	}

	// 2. Missing queryType and mutationType error
	mockJSONInvalidSchema := `{
		"data": {
			"__schema": {
				"types": []
			}
		}
	}`
	_, err = ParseGraphQLIntrospection([]byte(mockJSONInvalidSchema), "")
	if err == nil {
		t.Error("expected error due to missing queryType and mutationType, got nil")
	}

	// 3. Invalid JSON error
	_, err = ParseGraphQLIntrospection([]byte("{invalid-json"), "")
	if err == nil {
		t.Error("expected error on invalid JSON, got nil")
	}
}

func TestParseGraphQLIntrospection_NoArgumentsAndIntrospectionSkipping(t *testing.T) {
	mockJSON := `{
		"data": {
			"__schema": {
				"queryType": { "name": "Query" },
				"types": [
					{
						"kind": "OBJECT",
						"name": "Query",
						"fields": [
							{ "name": "__schema", "type": { "kind": "OBJECT", "name": "__Schema" } },
							{ "name": "ping", "type": { "kind": "SCALAR", "name": "String" } }
						]
					}
				]
			}
		}
	}`

	parsed, err := ParseGraphQLIntrospection([]byte(mockJSON), "/gql")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should only have 1 endpoint (ping) since __schema is skipped
	if len(parsed.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint (ping), got %d", len(parsed.Endpoints))
	}

	ep := parsed.Endpoints[0]
	if ep.Path != "/gql?query=ping" {
		t.Errorf("expected path /gql?query=ping, got %s", ep.Path)
	}

	// Check query format (no arguments means "{ ping }")
	queryProp := ep.Schema.Properties["query"]
	if len(queryProp.Enum) != 1 || queryProp.Enum[0] != "{ ping }" {
		t.Errorf("expected query '{ ping }', got '%v'", queryProp.Enum[0])
	}
}

func TestParseGraphQLIntrospection_ComplexTypesAndSelectionDepth(t *testing.T) {
	mockJSON := `{
		"data": {
			"__schema": {
				"queryType": { "name": "Query" },
				"types": [
					{
						"kind": "OBJECT",
						"name": "Query",
						"fields": [
							{
								"name": "search",
								"args": [
									{
										"name": "criteria",
										"type": {
											"kind": "NON_NULL",
											"ofType": {
												"kind": "INPUT_OBJECT",
												"name": "SearchInput"
											}
										}
									}
								],
								"type": {
									"kind": "OBJECT",
									"name": "SearchResult"
								}
							}
						]
					},
					{
						"kind": "INPUT_OBJECT",
						"name": "SearchInput",
						"inputFields": [
							{
								"name": "query",
								"type": {
									"kind": "NON_NULL",
									"ofType": {
										"kind": "SCALAR",
										"name": "String"
									}
								}
							},
							{
								"name": "tags",
								"type": {
									"kind": "LIST",
									"ofType": {
										"kind": "NON_NULL",
										"ofType": {
											"kind": "ENUM",
											"name": "Tag"
										}
									}
								}
							},
							{
								"name": "count",
								"type": {
									"kind": "SCALAR",
									"name": "Int"
								}
							},
							{
								"name": "ratio",
								"type": {
									"kind": "SCALAR",
									"name": "Float"
								}
							},
							{
								"name": "active",
								"type": {
									"kind": "SCALAR",
									"name": "Boolean"
								}
							}
						]
					},
					{
						"kind": "ENUM",
						"name": "Tag",
						"enumValues": [
							{ "name": "NEW" },
							{ "name": "POPULAR" }
						]
					},
					{
						"kind": "OBJECT",
						"name": "SearchResult",
						"fields": [
							{
								"name": "items",
								"type": {
									"kind": "LIST",
									"ofType": {
										"kind": "OBJECT",
										"name": "Item"
									}
								}
							}
						]
					},
					{
						"kind": "OBJECT",
						"name": "Item",
						"fields": [
							{
								"name": "id",
								"type": {
									"kind": "NON_NULL",
									"ofType": {
										"kind": "SCALAR",
										"name": "ID"
									}
								}
							},
							{
								"name": "details",
								"type": {
									"kind": "OBJECT",
									"name": "ItemDetails"
								}
							}
						]
					},
					{
						"kind": "OBJECT",
						"name": "ItemDetails",
						"fields": [
							{
								"name": "description",
								"type": {
									"kind": "SCALAR",
									"name": "String"
								}
							},
							{
								"name": "nestedTooDeep",
								"type": {
									"kind": "OBJECT",
									"name": "ItemDetails"
								}
							}
						]
					}
				]
			}
		}
	}`

	parsed, err := ParseGraphQLIntrospection([]byte(mockJSON), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(parsed.Endpoints) != 1 {
		t.Fatalf("expected 1 endpoint, got %d", len(parsed.Endpoints))
	}

	ep := parsed.Endpoints[0]

	// 1. Verify variable schema mappings: Input Object, Array, Enum, Int, Float, Boolean
	variablesProp, ok := ep.Schema.Properties["variables"]
	if !ok {
		t.Fatalf("missing variables property")
	}

	criteriaProp, ok := variablesProp.Properties["criteria"]
	if !ok {
		t.Fatalf("missing criteria property in variables")
	}
	if criteriaProp.Type != "object" {
		t.Errorf("expected criteria type 'object', got %s", criteriaProp.Type)
	}

	// Verify required fields in criteria
	if len(criteriaProp.Required) != 1 || criteriaProp.Required[0] != "query" {
		t.Errorf("expected criteria required fields ['query'], got %v", criteriaProp.Required)
	}

	// Verify criteria.query -> String
	queryProp, ok := criteriaProp.Properties["query"]
	if !ok || queryProp.Type != "string" {
		t.Errorf("expected criteria.query to be string, got %v", queryProp)
	}

	// Verify criteria.tags -> Array of String Enum
	tagsProp, ok := criteriaProp.Properties["tags"]
	if !ok || tagsProp.Type != "array" || tagsProp.Items == nil || tagsProp.Items.Type != "string" {
		t.Fatalf("expected criteria.tags to be array of string, got %v", tagsProp)
	}
	if len(tagsProp.Items.Enum) != 2 || tagsProp.Items.Enum[0] != "NEW" || tagsProp.Items.Enum[1] != "POPULAR" {
		t.Errorf("expected tags enum values ['NEW', 'POPULAR'], got %v", tagsProp.Items.Enum)
	}

	// Verify criteria.count -> integer
	countProp, ok := criteriaProp.Properties["count"]
	if !ok || countProp.Type != "integer" {
		t.Errorf("expected count to be integer, got %v", countProp)
	}

	// Verify criteria.ratio -> number
	ratioProp, ok := criteriaProp.Properties["ratio"]
	if !ok || ratioProp.Type != "number" {
		t.Errorf("expected ratio to be number, got %v", ratioProp)
	}

	// Verify criteria.active -> boolean
	activeProp, ok := criteriaProp.Properties["active"]
	if !ok || activeProp.Type != "boolean" {
		t.Errorf("expected active to be boolean, got %v", activeProp)
	}

	// 2. Verify selection set construction & depth limitation (depth limit is 2)
	queryEnumVal := ep.Schema.Properties["query"].Enum[0].(string)
	
	// Expect selection: { items { id details { description } } }
	if !strings.Contains(queryEnumVal, "description") {
		t.Errorf("expected query to contain 'description' at depth 3, got '%s'", queryEnumVal)
	}
	if strings.Contains(queryEnumVal, "nestedTooDeep") {
		t.Errorf("expected query NOT to contain 'nestedTooDeep' (exceeding depth limits), got '%s'", queryEnumVal)
	}
}

func TestParseGraphQLIntrospection_UnionAndInterface(t *testing.T) {
	mockJSON := `{
		"data": {
			"__schema": {
				"queryType": { "name": "Query" },
				"types": [
					{
						"kind": "OBJECT",
						"name": "Query",
						"fields": [
							{
								"name": "search",
								"type": {
									"kind": "UNION",
									"name": "SearchResultUnion"
								}
							}
						]
					},
					{
						"kind": "UNION",
						"name": "SearchResultUnion",
						"possibleTypes": [
							{ "kind": "OBJECT", "name": "User" },
							{ "kind": "OBJECT", "name": "Post" }
						]
					},
					{
						"kind": "OBJECT",
						"name": "User",
						"fields": [
							{ "name": "username", "type": { "kind": "SCALAR", "name": "String" } }
						]
					},
					{
						"kind": "OBJECT",
						"name": "Post",
						"fields": [
							{ "name": "title", "type": { "kind": "SCALAR", "name": "String" } }
						]
					}
				]
			}
		}
	}`

	parsed, err := ParseGraphQLIntrospection([]byte(mockJSON), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	ep := parsed.Endpoints[0]
	queryEnumVal := ep.Schema.Properties["query"].Enum[0].(string)

	// Expect selection: { search { ... on User { username } ... on Post { title } } }
	expectedSubStr1 := "... on User { username }"
	expectedSubStr2 := "... on Post { title }"
	if !strings.Contains(queryEnumVal, expectedSubStr1) || !strings.Contains(queryEnumVal, expectedSubStr2) {
		t.Errorf("expected union selection set to contain inline fragments, got '%s'", queryEnumVal)
	}
}

