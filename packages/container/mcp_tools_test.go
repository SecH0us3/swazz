// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"encoding/json"
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
