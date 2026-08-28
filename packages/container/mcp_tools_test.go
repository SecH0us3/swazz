// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"swazz-engine/internal/mcp"
	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
)

func TestAllowlistedTools(t *testing.T) {
	eps := []swagger.EndpointConfig{
		{Path: "mcp://tool/bank__searchCards", Method: "CALL"},
		{Path: "/health", Method: "GET"},
		{Path: "mcp://tool/listTransactions", Method: "CALL"},
	}

	got := allowlistedTools(eps)

	assert.True(t, got["bank__searchCards"])
	assert.True(t, got["listTransactions"])
	assert.Len(t, got, 2, "plain HTTP endpoints must not land in the MCP allowlist")
}

func TestAllowlistedTools_NoMCPEntries(t *testing.T) {
	// An empty result is what triggers the "everything gets fuzzed" warning, so
	// it must not be confused with "one entry that happens to match nothing".
	got := allowlistedTools([]swagger.EndpointConfig{{Path: "/v1/users", Method: "GET"}})
	assert.Empty(t, got)
}

func TestAllowlistSnippet_IsValidJSONCFragment(t *testing.T) {
	snippet := allowlistSnippet([]string{"bank__searchCards", "get_current_utc_time"})

	// The snippet is meant to be pasted into a config, so it has to parse once
	// wrapped as an object — a trailing comma or a stray one would break that.
	wrapped := "{" + strings.TrimSuffix(snippet, ",") + "}"

	var parsed struct {
		EndpointDefinitions []swagger.EndpointConfig `json:"endpoint_definitions"`
	}
	assert.NoError(t, json.Unmarshal([]byte(wrapped), &parsed))
	assert.Len(t, parsed.EndpointDefinitions, 2)
	assert.Equal(t, "mcp://tool/bank__searchCards", parsed.EndpointDefinitions[0].Path)
	assert.Equal(t, "CALL", parsed.EndpointDefinitions[0].Method)
	assert.Equal(t, "mcp://tool/get_current_utc_time", parsed.EndpointDefinitions[1].Path)
}

func TestToolConfirmationFlags(t *testing.T) {
	tests := []struct {
		name        string
		raw         string
		wantConfirm bool
		want2FA     bool
		wantSource  string
	}{
		{
			name:       "undeclared",
			raw:        `{"name":"t","inputSchema":{"type":"object"}}`,
			wantSource: "",
		},
		{
			name:       "declared false in _meta",
			raw:        `{"name":"t","_meta":{"requires_confirmation":false,"requires_2fa_confirmation":false}}`,
			wantSource: "_meta",
		},
		{
			name:        "declared true in _meta",
			raw:         `{"name":"t","_meta":{"requires_confirmation":true,"requires_2fa_confirmation":true}}`,
			wantConfirm: true, want2FA: true, wantSource: "_meta",
		},
		{
			name:        "annotations fallback",
			raw:         `{"name":"t","annotations":{"requires_confirmation":true}}`,
			wantConfirm: true, wantSource: "annotations",
		},
		{
			name:       "unrelated _meta keys do not count as a declaration",
			raw:        `{"name":"t","_meta":{"is_public":true}}`,
			wantSource: "",
		},
		{
			name:        "_meta wins over annotations",
			raw:         `{"name":"t","_meta":{"requires_confirmation":true},"annotations":{"requires_confirmation":false}}`,
			wantConfirm: true, wantSource: "_meta",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var tool mcp.Tool
			assert.NoError(t, json.Unmarshal([]byte(tt.raw), &tool))

			confirm, twoFA, source := tool.ConfirmationFlags()
			assert.Equal(t, tt.wantConfirm, confirm)
			assert.Equal(t, tt.want2FA, twoFA)
			assert.Equal(t, tt.wantSource, source)
		})
	}
}

func TestListMCPTools(t *testing.T) {
	// 1. Error when no MCP server config
	err := listMCPTools(&swagger.Config{})
	assert.Error(t, err)

	// 2. Mock HTTP MCP server with timeout and empty allowlist warning
	mux := http.NewServeMux()
	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		var req mcp.Request
		_ = json.NewDecoder(r.Body).Decode(&req)

		var resp mcp.Response
		resp.JSONRPC = "2.0"
		resp.ID = req.ID

		switch req.Method {
		case "initialize":
			resp.Result = json.RawMessage(`{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"test-server","version":"1.0.0"}}`)
		case "tools/list":
			tools := []mcp.Tool{
				{
					Name: "transfer_funds",
					Meta: json.RawMessage(`{"requires_confirmation":true,"requires_2fa_confirmation":true}`),
				},
				{
					Name: "search_cards",
				},
			}
			data, _ := json.Marshal(map[string]any{"tools": tools})
			resp.Result = data
		}
		_ = json.NewEncoder(w).Encode(resp)
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	cfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{
			Type: "http",
			URL:  ts.URL + "/mcp",
		},
		Endpoints: []swagger.EndpointConfig{
			{Path: "mcp://tool/transfer_funds", Method: "CALL"},
		},
		Settings: swagger.Settings{
			TimeoutMs: 5000,
		},
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
	}

	err = listMCPTools(cfg)
	assert.NoError(t, err)

	// 3. Test when no tools are in scope (len(allowed) == 0)
	noScopeCfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{
			Type: "http",
			URL:  ts.URL + "/mcp",
		},
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
	}
	err = listMCPTools(noScopeCfg)
	assert.NoError(t, err)

	// 4. Empty tool list
	emptyMux := http.NewServeMux()
	emptyMux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		var req mcp.Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		var resp mcp.Response
		resp.JSONRPC = "2.0"
		resp.ID = req.ID
		if req.Method == "initialize" {
			resp.Result = json.RawMessage(`{"protocolVersion":"2024-11-05"}`)
		} else if req.Method == "tools/list" {
			resp.Result = json.RawMessage(`{"tools":[]}`)
		}
		_ = json.NewEncoder(w).Encode(resp)
	})
	emptyTs := httptest.NewServer(emptyMux)
	defer emptyTs.Close()

	emptyCfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{
			Type: "http",
			URL:  emptyTs.URL + "/mcp",
		},
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
	}
	err = listMCPTools(emptyCfg)
	assert.NoError(t, err)

	// 5. Connect failure
	failConnCfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{
			Type: "http",
			URL:  "http://127.0.0.1:1/mcp",
		},
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
	}
	err = listMCPTools(failConnCfg)
	assert.Error(t, err)

	// 6. ListTools failure
	errMux := http.NewServeMux()
	errMux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		var req mcp.Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		var resp mcp.Response
		resp.JSONRPC = "2.0"
		resp.ID = req.ID
		if req.Method == "initialize" {
			resp.Result = json.RawMessage(`{"protocolVersion":"2024-11-05"}`)
		} else if req.Method == "tools/list" {
			resp.Error = &mcp.RPCError{Code: -32603, Message: "internal error"}
		}
		_ = json.NewEncoder(w).Encode(resp)
	})
	errTs := httptest.NewServer(errMux)
	defer errTs.Close()

	errListCfg := &swagger.Config{
		MCPServer: &swagger.MCPServerConfig{
			Type: "http",
			URL:  errTs.URL + "/mcp",
		},
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
	}
	err = listMCPTools(errListCfg)
	assert.Error(t, err)
}

func TestListMCPTools_WithAuthSequence(t *testing.T) {
	var gotAuthHeader string
	var gotCookie string

	mux := http.NewServeMux()
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "session", Value: "session-12345"})
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"token": "secret-jwt-token",
		})
	})
	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		gotAuthHeader = r.Header.Get("Authorization")
		if c, err := r.Cookie("session"); err == nil {
			gotCookie = c.Value
		}

		var req mcp.Request
		_ = json.NewDecoder(r.Body).Decode(&req)
		var resp mcp.Response
		resp.JSONRPC = "2.0"
		resp.ID = req.ID
		if req.Method == "initialize" {
			resp.Result = json.RawMessage(`{"protocolVersion":"2024-11-05"}`)
		} else if req.Method == "tools/list" {
			resp.Result = json.RawMessage(`{"tools":[{"name":"auth_tool","inputSchema":{"type":"object"}}]}`)
		}
		_ = json.NewEncoder(w).Encode(resp)
	})

	ts := httptest.NewServer(mux)
	defer ts.Close()

	cfg := &swagger.Config{
		BaseURL: ts.URL,
		MCPServer: &swagger.MCPServerConfig{
			Type: "http",
			URL:  ts.URL + "/mcp",
		},
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true,
		},
		AuthSequence: []swagger.AuthStep{
			{
				Method: "POST",
				URL:    "/login",
				ExtractVariables: map[string]string{
					"token": "tok",
				},
				SetHeaders: map[string]string{
					"Authorization": "Bearer {{tok}}",
				},
				ExtractCookies: []string{"session"},
			},
		},
	}

	err := listMCPTools(cfg)
	assert.NoError(t, err)
	assert.Equal(t, "Bearer secret-jwt-token", gotAuthHeader)
	assert.Equal(t, "session-12345", gotCookie)
}
