package swagger

import "strings"

// resolveSchema resolves a JSON schema, handling $ref with cycle detection.
// seenRefs tracks $ref strings on the call stack to prevent infinite recursion.
func resolveSchema(schema any, spec map[string]any, seenRefs map[string]bool) SchemaProperty {
	m, ok := schema.(map[string]any)
	if !ok {
		return SchemaProperty{Type: "object", Properties: make(map[string]*SchemaProperty)}
	}

	// Handle $ref with cycle detection
	if ref, ok := m["$ref"].(string); ok {
		if seenRefs == nil {
			seenRefs = make(map[string]bool)
		}
		if seenRefs[ref] {
			// Circular reference — safe fallback
			return SchemaProperty{Type: "object"}
		}
		nextSeen := copySeenRefs(seenRefs)
		nextSeen[ref] = true

		resolved := resolveRef(ref, spec)
		if resolved != nil {
			return resolveSchema(resolved, spec, nextSeen)
		}
		return SchemaProperty{Type: "object", Properties: make(map[string]*SchemaProperty)}
	}

	result := SchemaProperty{
		Type:   getStringField(m, "type"),
		Format: getStringField(m, "format"),
	}

	// Enum
	if enumRaw, ok := m["enum"].([]any); ok {
		result.Enum = enumRaw
	}

	// Object with properties
	if propsRaw, ok := m["properties"].(map[string]any); ok {
		result.Type = "object"
		result.Properties = make(map[string]*SchemaProperty)
		for key, propSchema := range propsRaw {
			resolved := resolveSchema(propSchema, spec, seenRefs)
			result.Properties[key] = &resolved
		}
	}

	// Propagate required field list
	if reqRaw, ok := m["required"].([]any); ok && len(reqRaw) > 0 {
		for _, r := range reqRaw {
			if s, ok := r.(string); ok {
				result.Required = append(result.Required, s)
			}
		}
	}

	// allOf — merge properties and required lists
	if allOf, ok := m["allOf"].([]any); ok {
		result.Type = "object"
		if result.Properties == nil {
			result.Properties = make(map[string]*SchemaProperty)
		}
		for _, sub := range allOf {
			resolved := resolveSchema(sub, spec, seenRefs)
			if resolved.Properties != nil {
				for k, v := range resolved.Properties {
					result.Properties[k] = v
				}
			}
			if len(resolved.Required) > 0 {
				result.Required = append(result.Required, resolved.Required...)
			}
		}
	}

	// Array items
	if items, ok := m["items"]; ok {
		result.Type = "array"
		resolved := resolveSchema(items, spec, seenRefs)
		result.Items = &resolved
	}

	return result
}

// resolveRef resolves a JSON pointer $ref like "#/definitions/User".
func resolveRef(ref string, spec map[string]any) any {
	if !strings.HasPrefix(ref, "#/") {
		return nil
	}

	parts := strings.Split(ref[2:], "/")
	var current any = spec

	for _, segment := range parts {
		m, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current, ok = m[segment]
		if !ok {
			return nil
		}
	}

	return current
}

func copySeenRefs(src map[string]bool) map[string]bool {
	dst := make(map[string]bool, len(src)+1)
	for k, v := range src {
		dst[k] = v
	}
	return dst
}
