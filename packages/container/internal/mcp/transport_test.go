// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package mcp

import (
	"encoding/json"
	"testing"

	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTool_ConfirmationFlags(t *testing.T) {
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
			var tool Tool
			require.NoError(t, json.Unmarshal([]byte(tt.raw), &tool))
			confirm, twoFA, src := tool.ConfirmationFlags()
			assert.Equal(t, tt.wantConfirm, confirm)
			assert.Equal(t, tt.want2FA, twoFA)
			assert.Equal(t, tt.wantSource, src)
		})
	}
}

func TestNewClientFromConfig(t *testing.T) {
	// 1. Nil config
	c, err := NewClientFromConfig(nil, nil, nil, false, nil)
	assert.Error(t, err)
	assert.Nil(t, c)

	// 2. Stdio client
	cStdio, err := NewClientFromConfig(&swagger.MCPServerConfig{
		Type:    "stdio",
		Command: "node",
		Args:    []string{"server.js"},
	}, map[string]string{"X-Test": "1"}, map[string]string{"sess": "abc"}, false, nil)
	assert.NoError(t, err)
	assert.IsType(t, &StdioClient{}, cStdio)

	// 3. SSE client
	cSSE, err := NewClientFromConfig(&swagger.MCPServerConfig{
		Type: "sse",
		URL:  "http://localhost:8000/sse",
	}, map[string]string{"Authorization": "Bearer token"}, map[string]string{"sid": "123"}, true, nil)
	assert.NoError(t, err)
	assert.IsType(t, &SSEClient{}, cSSE)

	// 4. HTTP client
	cHTTP, err := NewClientFromConfig(&swagger.MCPServerConfig{
		Type: "http",
		URL:  "http://localhost:8000/mcp",
	}, map[string]string{"Authorization": "Bearer token"}, map[string]string{"sid": "123"}, true, nil)
	assert.NoError(t, err)
	assert.IsType(t, &HTTPClient{}, cHTTP)

	// 5. Unsupported type
	cInvalid, err := NewClientFromConfig(&swagger.MCPServerConfig{
		Type: "grpc-unknown",
	}, nil, nil, false, nil)
	assert.Error(t, err)
	assert.Nil(t, cInvalid)
}
