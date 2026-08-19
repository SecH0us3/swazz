// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ws

import (
	"encoding/json"
	"fmt"

	"swazz-engine/internal/swagger"
)

// SynthesizeWSEndpoint creates a default interactive message schema for a WebSocket endpoint.
func SynthesizeWSEndpoint(wsURL string) (*swagger.ParseResult, error) {
	schema := swagger.SchemaProperty{
		Type: "object",
		Properties: map[string]*swagger.SchemaProperty{
			"action":  {Type: "string"},
			"payload": {Type: "object"},
			"data":    {Type: "object"},
			"query":   {Type: "string"},
			"id":      {Type: "string"},
		},
	}

	endpoint := swagger.EndpointConfig{
		Path:        wsURL,
		Method:      "WS",
		ContentType: "application/json",
		Schema:      schema,
	}

	return &swagger.ParseResult{
		BasePath:  "",
		Endpoints: []swagger.EndpointConfig{endpoint},
	}, nil
}

// ParseAsyncAPISpec parses an AsyncAPI spec and extracts WebSocket endpoints.
func ParseAsyncAPISpec(raw []byte, baseURL string) (*swagger.ParseResult, error) {
	var spec map[string]any
	if err := json.Unmarshal(raw, &spec); err != nil {
		return nil, fmt.Errorf("invalid asyncapi spec: %w", err)
	}

	result := &swagger.ParseResult{
		BasePath:  baseURL,
		Endpoints: []swagger.EndpointConfig{},
	}

	channels, ok := spec["channels"].(map[string]any)
	if !ok {
		return result, nil
	}

	for path, chVal := range channels {
		ch, ok := chVal.(map[string]any)
		if !ok {
			continue
		}

		if pub, ok := ch["publish"].(map[string]any); ok {
			msg, _ := pub["message"].(map[string]any)
			schema := extractAsyncAPISchema(msg)
			result.Endpoints = append(result.Endpoints, swagger.EndpointConfig{
				Path:        path,
				Method:      "WS",
				ContentType: "application/json",
				Schema:      schema,
			})
		} else if sub, ok := ch["subscribe"].(map[string]any); ok {
			msg, _ := sub["message"].(map[string]any)
			schema := extractAsyncAPISchema(msg)
			result.Endpoints = append(result.Endpoints, swagger.EndpointConfig{
				Path:        path,
				Method:      "WS",
				ContentType: "application/json",
				Schema:      schema,
			})
		}
	}

	return result, nil
}

func extractAsyncAPISchema(msg map[string]any) swagger.SchemaProperty {
	schema := swagger.SchemaProperty{Type: "object"}
	if msg == nil {
		return schema
	}

	if payload, ok := msg["payload"].(map[string]any); ok {
		if typ, ok := payload["type"].(string); ok {
			schema.Type = typ
		}
		if props, ok := payload["properties"].(map[string]any); ok {
			schema.Properties = make(map[string]*swagger.SchemaProperty)
			for k, v := range props {
				if vmap, ok := v.(map[string]any); ok {
					p := extractAsyncAPISchema(map[string]any{"payload": vmap})
					schema.Properties[k] = &p
				}
			}
		}
	}
	return schema
}
