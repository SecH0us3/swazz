// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package ws

import (
	"encoding/json"
	"fmt"
	"net/url"

	"swazz-engine/internal/swagger"
)

// SynthesizeWSEndpoint creates a default interactive message schema for a WebSocket endpoint.
func SynthesizeWSEndpoint(wsURL string) (*swagger.ParseResult, error) {
	schema := swagger.SchemaProperty{
		Type: "object",
		Properties: map[string]*swagger.SchemaProperty{
			"action":  {Type: "string", Enum: []any{"search", "query", "update", "user", "exec_diag", "get_config", "crash"}},
			"payload": {Type: "object", Properties: map[string]*swagger.SchemaProperty{"cmd": {Type: "string"}}},
			"cmd":     {Type: "string"},
			"data":    {Type: "object"},
			"query":   {Type: "string"},
			"id":      {Type: "integer"},
		},
	}

	// Split the URL the way ParseAsyncAPISpec does: the origin belongs in BasePath and
	// only the channel path in Path. Storing the whole URL in Path made the executor
	// append it to base_url — the target became
	// ws://host:port/ws://host:port/ws and every handshake came back 404.
	u, err := url.Parse(wsURL)
	if err != nil {
		return nil, fmt.Errorf("invalid websocket url %q: %w", wsURL, err)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("websocket url %q has no host", wsURL)
	}

	path := u.EscapedPath()
	if path == "" {
		path = "/"
	}
	if u.RawQuery != "" {
		path += "?" + u.RawQuery
	}

	endpoint := swagger.EndpointConfig{
		Path:        path,
		Method:      "WS",
		ContentType: "application/json",
		Schema:      schema,
	}

	// Filled in so that swagger_urls alone is enough: the loader adopts this as the
	// base URL when the config does not set one.
	return &swagger.ParseResult{
		BasePath:  u.Scheme + "://" + u.Host,
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
