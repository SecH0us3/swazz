// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package swagger

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMCPEndpointPredicates(t *testing.T) {
	for _, c := range []struct {
		method, path   string
		server, webmcp bool
	}{
		{"CALL", "mcp://tool/calc", true, false},
		{"READ", "mcp://resource/file:///etc/passwd", true, false},
		{"PROMPT", "mcp://prompt/review", true, false},
		{"CALL", "calc", true, false}, // a configured tool name, before the server lists it
		{"MCP", "anything", true, false},
		{"CALL", "webmcp://tool/search", false, true},
		{"GET", "/users", false, false},
		{"CALL", "https://api.example.com/call", false, false},
	} {
		assert.Equal(t, c.server, IsMCPServerEndpoint(c.method, c.path), "%s %s", c.method, c.path)
		assert.Equal(t, c.webmcp, IsWebMCPEndpoint(c.path), "%s", c.path)
	}
}
