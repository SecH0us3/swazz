package graphql

import (
	"encoding/json"
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
)

// IntrospectionQuery string used to query active GraphQL servers.
const IntrospectionQuery = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: true) {
        name
        description
        args {
          name
          description
          type {
            ...TypeRef
          }
          defaultValue
        }
        type {
          ...TypeRef
        }
        isDeprecated
      }
      inputFields {
        name
        description
        type {
          ...TypeRef
        }
        defaultValue
      }
      enumValues(includeDeprecated: true) {
        name
        description
      }
      possibleTypes {
        ...TypeRef
      }
    }
  }
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
}`

type TypeRef struct {
	Kind   string   `json:"kind"`
	Name   *string  `json:"name"`
	OfType *TypeRef `json:"ofType"`
}

type InputValue struct {
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Type         TypeRef  `json:"type"`
	DefaultValue *string  `json:"defaultValue"`
}

type Field struct {
	Name         string       `json:"name"`
	Description  string       `json:"description"`
	Args         []InputValue `json:"args"`
	Type         TypeRef      `json:"type"`
	IsDeprecated bool         `json:"isDeprecated"`
}

type EnumValue struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type TypeDef struct {
	Kind          string       `json:"kind"`
	Name          string       `json:"name"`
	Description   string       `json:"description"`
	Fields        []Field      `json:"fields"`
	InputFields   []InputValue `json:"inputFields"`
	EnumValues    []EnumValue  `json:"enumValues"`
	PossibleTypes []TypeRef    `json:"possibleTypes"`
}

type Schema struct {
	QueryType    *TypeName `json:"queryType"`
	MutationType *TypeName `json:"mutationType"`
	Types        []TypeDef `json:"types"`
}

type TypeName struct {
	Name string `json:"name"`
}

type IntrospectionResult struct {
	Data struct {
		Schema Schema `json:"__schema"`
	} `json:"data"`
}

// ParseGraphQLIntrospection parses a GraphQL introspection JSON output into EndpointConfigs.
func ParseGraphQLIntrospection(raw []byte, defaultPath string) (*swagger.ParseResult, error) {
	var res IntrospectionResult
	err := json.Unmarshal(raw, &res)
	if err != nil || (res.Data.Schema.QueryType == nil && res.Data.Schema.MutationType == nil) {
		// Try to parse direct __schema wrapper (without data)
		var direct struct {
			Schema Schema `json:"__schema"`
		}
		if errDirect := json.Unmarshal(raw, &direct); errDirect == nil && (direct.Schema.QueryType != nil || direct.Schema.MutationType != nil) {
			res.Data.Schema = direct.Schema
		} else if err != nil {
			return nil, fmt.Errorf("invalid graphql introspection json: %w", err)
		}
	}

	schema := res.Data.Schema
	if schema.QueryType == nil && schema.MutationType == nil {
		return nil, fmt.Errorf("invalid graphql schema: missing queryType and mutationType")
	}

	typesMap := make(map[string]TypeDef)
	for _, t := range schema.Types {
		typesMap[t.Name] = t
	}

	var endpoints []swagger.EndpointConfig
	basePath := defaultPath
	if basePath == "" {
		basePath = "/graphql"
	}

	// Helper to add endpoints from a root type (Query / Mutation)
	addEndpoints := func(rootTypeName string, isMutation bool) {
		rootType, ok := typesMap[rootTypeName]
		if !ok {
			return
		}

		for _, field := range rootType.Fields {
			// Skip internal introspective fields (like __schema, __type)
			if strings.HasPrefix(field.Name, "__") {
				continue
			}

			// 1. Build Query String
			var argDefs []string
			var argCalls []string
			for _, arg := range field.Args {
				argDefs = append(argDefs, fmt.Sprintf("$%s: %s", arg.Name, formatGQLType(arg.Type)))
				argCalls = append(argCalls, fmt.Sprintf("%s: $%s", arg.Name, arg.Name))
			}

			baseTypeRef := getBaseType(field.Type)
			var selection string
			if baseTypeRef.Kind == "OBJECT" || baseTypeRef.Kind == "INTERFACE" || baseTypeRef.Kind == "UNION" {
				selection = " " + buildSelectionSet(field.Type, typesMap, 1)
			}

			var queryStr string
			opType := "query"
			if isMutation {
				opType = "mutation"
			}

			if len(argDefs) > 0 {
				queryStr = fmt.Sprintf("%s %s(%s) { %s(%s)%s }", opType, field.Name, strings.Join(argDefs, ", "), field.Name, strings.Join(argCalls, ", "), selection)
			} else {
				if isMutation {
					queryStr = fmt.Sprintf("mutation { %s%s }", field.Name, selection)
				} else {
					queryStr = fmt.Sprintf("{ %s%s }", field.Name, selection)
				}
			}

			// 2. Build Variables Schema
			variablesProps := make(map[string]*swagger.SchemaProperty)
			var requiredArgs []string

			for _, arg := range field.Args {
				argProp := mapGQLTypeToSchema(arg.Type, typesMap)
				variablesProps[arg.Name] = argProp
				if arg.Type.Kind == "NON_NULL" {
					requiredArgs = append(requiredArgs, arg.Name)
				}
			}

			variablesSchema := swagger.SchemaProperty{
				Type:       "object",
				Properties: variablesProps,
				Required:   requiredArgs,
			}

			// 3. Request Body Schema: {"query": "...", "variables": {...}}
			endpointSchema := swagger.SchemaProperty{
				Type: "object",
				Properties: map[string]*swagger.SchemaProperty{
					"query": {
						Type: "string",
						Enum: []any{queryStr},
					},
				},
				Required: []string{"query"},
			}
			if len(variablesProps) > 0 {
				endpointSchema.Properties["variables"] = &variablesSchema
				// If there are variables, mark them as required if any variable is required
				if len(requiredArgs) > 0 {
					endpointSchema.Required = append(endpointSchema.Required, "variables")
				}
			}

			// 4. Create EndpointConfig
			opQueryParam := "query"
			if isMutation {
				opQueryParam = "mutation"
			}
			pathWithOp := fmt.Sprintf("%s?%s=%s", basePath, opQueryParam, field.Name)

			ep := swagger.EndpointConfig{
				Path:        pathWithOp,
				Method:      "POST",
				Schema:      endpointSchema,
				ContentType: "application/json",
			}
			endpoints = append(endpoints, ep)
		}
	}

	if schema.QueryType != nil {
		addEndpoints(schema.QueryType.Name, false)
	}
	if schema.MutationType != nil {
		addEndpoints(schema.MutationType.Name, true)
	}

	return &swagger.ParseResult{
		BasePath:  "", // base path is included in defaultPath / basePath
		Endpoints: endpoints,
	}, nil
}

func getBaseType(ref TypeRef) TypeRef {
	curr := ref
	for curr.OfType != nil {
		curr = *curr.OfType
	}
	return curr
}

func formatGQLType(ref TypeRef) string {
	if ref.Kind == "NON_NULL" && ref.OfType != nil {
		return formatGQLType(*ref.OfType) + "!"
	}
	if ref.Kind == "LIST" && ref.OfType != nil {
		return "[" + formatGQLType(*ref.OfType) + "]"
	}
	if ref.Name != nil {
		return *ref.Name
	}
	return ""
}

func buildSelectionSet(ref TypeRef, typesMap map[string]TypeDef, depth int) string {
	if depth > 3 {
		return ""
	}
	base := getBaseType(ref)
	if base.Name == nil {
		return ""
	}
	t, ok := typesMap[*base.Name]
	if !ok {
		return ""
	}

	var fields []string
	if t.Kind == "UNION" {
		for _, posType := range t.PossibleTypes {
			if posType.Name != nil {
				subSel := buildSelectionSet(posType, typesMap, depth+1)
				if subSel != "" {
					fields = append(fields, fmt.Sprintf("... on %s %s", *posType.Name, subSel))
				}
			}
		}
	} else {
		// OBJECT or INTERFACE
		for _, f := range t.Fields {
			fBase := getBaseType(f.Type)
			if fBase.Kind == "SCALAR" || fBase.Kind == "ENUM" {
				fields = append(fields, f.Name)
			} else if depth < 3 && (fBase.Kind == "OBJECT" || fBase.Kind == "INTERFACE" || fBase.Kind == "UNION") {
				subSel := buildSelectionSet(f.Type, typesMap, depth+1)
				if subSel != "" {
					fields = append(fields, fmt.Sprintf("%s %s", f.Name, subSel))
				}
			}
		}
	}

	if len(fields) == 0 {
		return ""
	}
	return "{ " + strings.Join(fields, " ") + " }"
}

func mapGQLTypeToSchema(ref TypeRef, typesMap map[string]TypeDef) *swagger.SchemaProperty {
	var mapper func(TypeRef, int) *swagger.SchemaProperty
	mapper = func(r TypeRef, depth int) *swagger.SchemaProperty {
		if depth > 5 {
			return &swagger.SchemaProperty{Type: "string"}
		}
		if r.Kind == "NON_NULL" && r.OfType != nil {
			return mapper(*r.OfType, depth)
		}
		if r.Kind == "LIST" && r.OfType != nil {
			return &swagger.SchemaProperty{
				Type:  "array",
				Items: mapper(*r.OfType, depth),
			}
		}
		if r.Name == nil {
			return &swagger.SchemaProperty{Type: "string"}
		}

		name := *r.Name
		switch name {
		case "Int":
			return &swagger.SchemaProperty{Type: "integer"}
		case "Float":
			return &swagger.SchemaProperty{Type: "number"}
		case "Boolean":
			return &swagger.SchemaProperty{Type: "boolean"}
		case "String", "ID":
			return &swagger.SchemaProperty{Type: "string"}
		default:
			t, ok := typesMap[name]
			if ok {
				if t.Kind == "INPUT_OBJECT" {
					props := make(map[string]*swagger.SchemaProperty)
					var req []string
					for _, f := range t.InputFields {
						props[f.Name] = mapper(f.Type, depth+1)
						if f.Type.Kind == "NON_NULL" {
							req = append(req, f.Name)
						}
					}
					return &swagger.SchemaProperty{
						Type:       "object",
						Properties: props,
						Required:   req,
					}
				} else if t.Kind == "ENUM" {
					var enumVals []any
					for _, ev := range t.EnumValues {
						enumVals = append(enumVals, ev.Name)
					}
					return &swagger.SchemaProperty{
						Type: "string",
						Enum: enumVals,
					}
				}
			}
			return &swagger.SchemaProperty{Type: "string"}
		}
	}
	return mapper(ref, 0)
}
