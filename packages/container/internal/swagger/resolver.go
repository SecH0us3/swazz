package swagger

import (
	"strings"

	"swazz-engine/internal/logger"
)

// resolverCtx maintains the state of a single schema resolution root.
type resolverCtx struct {
	spec         map[string]any
	inProgress   map[string]bool
	resolvedRefs map[string]*SchemaProperty
	nodeCount    int
	maxNodes     int
	maxDepth     int
	depth        int
	truncated    bool
	endpointHint string
}

func newResolverCtx(spec map[string]any, endpointHint string) *resolverCtx {
	return &resolverCtx{
		spec:         spec,
		inProgress:   make(map[string]bool),
		resolvedRefs: make(map[string]*SchemaProperty),
		maxNodes:     50000,
		maxDepth:     64,
		endpointHint: endpointHint,
	}
}

// resolveSchema resolves a JSON schema, handling $ref with cycle detection and memoization.
// seenRefs tracks $ref strings on the call stack to prevent infinite recursion (for backward compatibility).
func resolveSchema(schema any, spec map[string]any, seenRefs map[string]bool) SchemaProperty {
	return resolveSchemaWithHint(schema, spec, seenRefs, "")
}

// resolveSchemaWithHint resolves a JSON schema, providing an endpoint hint for logs when safety budgets are exceeded.
func resolveSchemaWithHint(schema any, spec map[string]any, seenRefs map[string]bool, endpointHint string) SchemaProperty {
	ctx := newResolverCtx(spec, endpointHint)
	// Seed inProgress with any caller-specified seenRefs for safety/backward compatibility
	for k, v := range seenRefs {
		if v {
			ctx.inProgress[k] = true
		}
	}
	return ctx.resolve(schema)
}

func (ctx *resolverCtx) resolve(schema any) SchemaProperty {
	ctx.depth++
	defer func() { ctx.depth-- }()

	ctx.nodeCount++

	// Limit recursion depth
	if ctx.depth > ctx.maxDepth {
		if !ctx.truncated {
			ctx.truncated = true
			logger.Warn("Schema resolution depth limit (%d) reached. Truncated schema. Context: %s", ctx.maxDepth, ctx.endpointHint)
		}
		return SchemaProperty{Type: "object"}
	}

	// Hard budget on size of schema expansion
	if ctx.nodeCount > ctx.maxNodes {
		if !ctx.truncated {
			ctx.truncated = true
			logger.Warn("Schema resolution node budget (%d) exceeded. Truncated schema. Context: %s", ctx.maxNodes, ctx.endpointHint)
		}
		return SchemaProperty{Type: "object"}
	}

	m, ok := schema.(map[string]any)
	if !ok {
		return SchemaProperty{Type: "object", Properties: make(map[string]*SchemaProperty)}
	}

	// Handle $ref with cycle detection and memoization
	if ref, ok := m["$ref"].(string); ok {
		if ctx.inProgress[ref] {
			// Circular reference — safe fallback
			return SchemaProperty{Type: "object"}
		}

		if cached, exists := ctx.resolvedRefs[ref]; exists {
			return *cached
		}

		ctx.inProgress[ref] = true
		resolved := resolveRef(ref, ctx.spec)
		var result SchemaProperty
		if resolved != nil {
			result = ctx.resolve(resolved)
		} else {
			result = SchemaProperty{Type: "object", Properties: make(map[string]*SchemaProperty)}
		}
		ctx.inProgress[ref] = false

		ctx.resolvedRefs[ref] = &result
		return result
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
			resolved := ctx.resolve(propSchema)
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
			resolved := ctx.resolve(sub)
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
		resolved := ctx.resolve(items)
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
