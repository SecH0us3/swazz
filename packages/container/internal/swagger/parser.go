package swagger

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ParseSpec parses a Swagger/OpenAPI JSON spec into a ParseResult.
// Supports both OpenAPI 3.x and Swagger 2.0.
func ParseSpec(raw json.RawMessage) (*ParseResult, error) {
	var spec map[string]json.RawMessage
	if err := json.Unmarshal(raw, &spec); err != nil {
		return nil, fmt.Errorf("invalid spec: not a JSON object: %w", err)
	}

	// Full spec needed for $ref resolution
	var fullSpec map[string]any
	if err := json.Unmarshal(raw, &fullSpec); err != nil {
		return nil, fmt.Errorf("invalid spec: %w", err)
	}

	basePath := determineBasePath(fullSpec)

	pathsRaw, ok := spec["paths"]
	if !ok {
		return nil, fmt.Errorf("invalid spec: no \"paths\" found")
	}

	var paths map[string]json.RawMessage
	if err := json.Unmarshal(pathsRaw, &paths); err != nil {
		return nil, fmt.Errorf("invalid spec: \"paths\" is not an object: %w", err)
	}

	methods := []string{"get", "post", "put", "patch", "delete"}
	var endpoints []EndpointConfig

	for path, pathItemRaw := range paths {
		var pathItem map[string]json.RawMessage
		if err := json.Unmarshal(pathItemRaw, &pathItem); err != nil {
			continue
		}

		// Path-level parameters
		var pathLevelParams []any
		if pRaw, ok := pathItem["parameters"]; ok {
			json.Unmarshal(pRaw, &pathLevelParams)
		}

		for _, method := range methods {
			opRaw, ok := pathItem[method]
			if !ok {
				continue
			}

			var operation map[string]any
			if err := json.Unmarshal(opRaw, &operation); err != nil {
				continue
			}

			// Merge path-level + operation-level parameters
			allParams := mergeParams(pathLevelParams, operation)

			// Extract request body schema
			bodyResult := extractRequestSchema(operation, fullSpec)

			var schema SchemaProperty
			if bodyResult != nil {
				schema = bodyResult.schema
			}

			// If no body schema, create from query/path params
			if len(schema.Properties) == 0 {
				if paramSchema := extractParamsSchema(allParams); paramSchema != nil {
					schema = *paramSchema
				}
			}

			// Ensure schema has a type
			if schema.Type == "" && schema.Properties == nil {
				schema.Type = "object"
				schema.Properties = make(map[string]*SchemaProperty)
			}

			pathParams := extractPathParams(allParams)
			headerParams := extractHeaderParams(allParams, fullSpec)

			ep := EndpointConfig{
				Path:   path,
				Method: strings.ToUpper(method),
				Schema: schema,
			}
			if len(pathParams) > 0 {
				ep.PathParams = pathParams
			}
			if len(headerParams) > 0 {
				ep.HeaderParams = headerParams
			}
			if bodyResult != nil && bodyResult.contentType != "" {
				ep.ContentType = bodyResult.contentType
			}

			endpoints = append(endpoints, ep)
		}
	}

	return &ParseResult{
		BasePath:  basePath,
		Endpoints: endpoints,
	}, nil
}

// determineBasePath extracts the base URL from the spec.
func determineBasePath(spec map[string]any) string {
	// OpenAPI 3.x
	if _, ok := spec["openapi"]; ok {
		if servers, ok := spec["servers"].([]any); ok && len(servers) > 0 {
			if srv, ok := servers[0].(map[string]any); ok {
				if url, ok := srv["url"].(string); ok {
					return normalizeBasePath(url)
				}
			}
		}
		return ""
	}

	// Swagger 2.0
	if _, ok := spec["swagger"]; ok {
		scheme := "https"
		if schemes, ok := spec["schemes"].([]any); ok && len(schemes) > 0 {
			if s, ok := schemes[0].(string); ok {
				scheme = s
			}
		}
		host, _ := spec["host"].(string)
		bp, _ := spec["basePath"].(string)
		if host != "" {
			return normalizeBasePath(fmt.Sprintf("%s://%s%s", scheme, host, bp))
		}
		return normalizeBasePath(bp)
	}

	return ""
}

// normalizeBasePath replaces {param} placeholders in server URLs with "default".
func normalizeBasePath(path string) string {
	var result strings.Builder
	i := 0
	for i < len(path) {
		if path[i] == '{' {
			j := strings.IndexByte(path[i:], '}')
			if j >= 0 {
				result.WriteString("default")
				i += j + 1
				continue
			}
		}
		result.WriteByte(path[i])
		i++
	}
	return result.String()
}

type bodyResult struct {
	schema      SchemaProperty
	contentType string
}

// extractRequestSchema extracts the request body schema from an operation.
func extractRequestSchema(operation map[string]any, spec map[string]any) *bodyResult {
	// OpenAPI 3.x: requestBody → content → <mime> → schema
	if rb, ok := operation["requestBody"].(map[string]any); ok {
		if content, ok := rb["content"].(map[string]any); ok {
			preferred := []string{
				"application/json",
				"application/x-www-form-urlencoded",
				"multipart/form-data",
				"*/*",
			}

			var foundKey string
			for _, key := range preferred {
				if m, ok := content[key].(map[string]any); ok {
					if _, hasSchema := m["schema"]; hasSchema {
						foundKey = key
						break
					}
				}
			}

			// Fallback to any key with schema
			if foundKey == "" {
				for key, v := range content {
					if m, ok := v.(map[string]any); ok {
						if _, hasSchema := m["schema"]; hasSchema {
							foundKey = key
							break
						}
					}
				}
			}

			if foundKey != "" {
				if m, ok := content[foundKey].(map[string]any); ok {
					if s, ok := m["schema"]; ok {
						ct := foundKey
						if ct == "*/*" {
							ct = "application/json"
						}
						return &bodyResult{
							schema:      resolveSchema(s, spec, nil),
							contentType: ct,
						}
					}
				}
			}
		}
	}

	// Swagger 2.0: parameters with in: "body"
	if params, ok := operation["parameters"].([]any); ok {
		for _, p := range params {
			if pm, ok := p.(map[string]any); ok {
				if pm["in"] == "body" {
					if s, ok := pm["schema"]; ok {
						return &bodyResult{
							schema:      resolveSchema(s, spec, nil),
							contentType: "application/json",
						}
					}
				}
			}
		}
	}

	return nil
}

// mergeParams merges path-level and operation-level parameters.
func mergeParams(pathLevel []any, operation map[string]any) []any {
	var opParams []any
	if p, ok := operation["parameters"].([]any); ok {
		opParams = p
	}
	merged := make([]any, 0, len(pathLevel)+len(opParams))
	merged = append(merged, pathLevel...)
	merged = append(merged, opParams...)
	return merged
}

// extractParamsSchema extracts schemas from query parameters.
func extractParamsSchema(params []any) *SchemaProperty {
	props := make(map[string]*SchemaProperty)

	for _, p := range params {
		pm, ok := p.(map[string]any)
		if !ok {
			continue
		}
		in, _ := pm["in"].(string)
		if in == "body" || in == "header" || in == "path" {
			continue
		}
		name, _ := pm["name"].(string)
		if name == "" {
			continue
		}

		sp := &SchemaProperty{
			Type:   getStringField(pm, "type"),
			Format: getStringField(pm, "format"),
		}

		// Check nested schema
		if schema, ok := pm["schema"].(map[string]any); ok {
			if sp.Type == "" {
				sp.Type = getStringField(schema, "type")
			}
			if sp.Format == "" {
				sp.Format = getStringField(schema, "format")
			}
		}

		if sp.Type == "" {
			sp.Type = "string"
		}

		props[name] = sp
	}

	if len(props) == 0 {
		return nil
	}
	return &SchemaProperty{Type: "object", Properties: props}
}

// extractPathParams extracts path parameters as a SchemaProperty map.
func extractPathParams(params []any) map[string]*SchemaProperty {
	result := make(map[string]*SchemaProperty)

	for _, p := range params {
		pm, ok := p.(map[string]any)
		if !ok {
			continue
		}
		if pm["in"] != "path" {
			continue
		}
		name, _ := pm["name"].(string)
		if name == "" {
			continue
		}

		sp := &SchemaProperty{
			Type:   getStringField(pm, "type"),
			Format: getStringField(pm, "format"),
		}
		if schema, ok := pm["schema"].(map[string]any); ok {
			if sp.Type == "" {
				sp.Type = getStringField(schema, "type")
			}
			if sp.Format == "" {
				sp.Format = getStringField(schema, "format")
			}
		}
		if sp.Type == "" {
			sp.Type = "string"
		}
		result[name] = sp
	}

	return result
}

// extractHeaderParams extracts header parameters for injection fuzzing.
func extractHeaderParams(params []any, spec map[string]any) map[string]*SchemaProperty {
	result := make(map[string]*SchemaProperty)

	for _, p := range params {
		pm, ok := p.(map[string]any)
		if !ok {
			continue
		}
		if pm["in"] != "header" {
			continue
		}
		name, _ := pm["name"].(string)
		if name == "" {
			continue
		}

		if schema, ok := pm["schema"]; ok {
			resolved := resolveSchema(schema, spec, nil)
			result[name] = &resolved
		} else {
			result[name] = &SchemaProperty{
				Type:   getStringField(pm, "type"),
				Format: getStringField(pm, "format"),
			}
			if result[name].Type == "" {
				result[name].Type = "string"
			}
		}
	}

	return result
}

func getStringField(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}
