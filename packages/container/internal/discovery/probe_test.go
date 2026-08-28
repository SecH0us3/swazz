// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package discovery

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProbeService_ValidMCPServer(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)

		method, _ := req["method"].(string)
		id := req["id"]

		var result any
		switch method {
		case "initialize":
			result = map[string]any{
				"protocolVersion": "2024-11-05",
				"serverInfo":      map[string]any{"name": "test-mcp", "version": "1.0"},
				"capabilities":    map[string]any{"tools": map[string]any{}},
			}
		case "tools/list":
			result = map[string]any{
				"tools": []map[string]any{
					{
						"name":        "exec_query",
						"description": "Execute a SQL query",
						"inputSchema": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"query": map[string]any{"type": "string"},
							},
						},
					},
				},
			}
		}

		resp := map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	port, _ := strconv.Atoi(u.Port())

	svc := DiscoveredService{
		Name:        "test-mcp",
		Namespace:   "default",
		Host:        u.Hostname(),
		Port:        port,
		Endpoint:    "/",
		Transport:   "http",
		DisplayName: "test-mcp",
	}

	probed := ProbeService(context.Background(), svc, nil)
	require.Nil(t, probed.ProbeError)
	assert.Equal(t, "test-mcp", probed.ServerName)
	require.Len(t, probed.Tools, 1)
	assert.Equal(t, "exec_query", probed.Tools[0].Name)
}

func TestProbeService_UnreachableServer(t *testing.T) {
	svc := DiscoveredService{
		Name:      "gone-mcp",
		Namespace: "default",
		Host:      "127.0.0.1",
		Port:      19999, // nothing listening
		Endpoint:  "/mcp",
		Transport: "http",
	}

	probed := ProbeService(context.Background(), svc, nil)
	assert.NotNil(t, probed.ProbeError)
	assert.Empty(t, probed.Tools)
}

func TestProbeAll_WithSecretResolver(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader != "Bearer secret-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)

		method, _ := req["method"].(string)
		id := req["id"]

		var result any
		switch method {
		case "initialize":
			result = map[string]any{
				"protocolVersion": "2024-11-05",
				"serverInfo":      map[string]any{"name": "auth-mcp", "version": "1.0"},
				"capabilities":    map[string]any{"tools": map[string]any{}},
			}
		case "tools/list":
			result = map[string]any{
				"tools": []map[string]any{
					{
						"name":        "secure_tool",
						"description": "Secure tool",
					},
				},
			}
		}

		resp := map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
		json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	u, _ := url.Parse(srv.URL)
	port, _ := strconv.Atoi(u.Port())

	services := []DiscoveredService{
		{
			Name:          "auth-service",
			Namespace:     "prod",
			Host:          u.Hostname(),
			Port:          port,
			Endpoint:      "/",
			Transport:     "http",
			DisplayName:   "auth-service",
			AuthSecretRef: "mcp-secret",
		},
	}

	resolver := func(ns, name string) (string, error) {
		if ns == "prod" && name == "mcp-secret" {
			return "secret-token", nil
		}
		return "", errors.New("secret not found")
	}

	probedList := ProbeAll(context.Background(), services, 2, resolver)
	require.Len(t, probedList, 1)
	require.Nil(t, probedList[0].ProbeError)
	assert.Equal(t, "auth-service", probedList[0].ServerName)
	require.Len(t, probedList[0].Tools, 1)
	assert.Equal(t, "secure_tool", probedList[0].Tools[0].Name)
}
