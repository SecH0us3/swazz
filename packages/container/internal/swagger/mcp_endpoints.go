// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package swagger

import "strings"

// IsWebMCPEndpoint reports whether the endpoint is a browser WebMCP tool (webmcp://): executed
// by a browser-side executor, never by the configured MCP server.
func IsWebMCPEndpoint(path string) bool {
	return strings.HasPrefix(path, "webmcp://")
}

// IsMCPServerEndpoint reports whether the endpoint is served by the configured MCP server: an
// mcp:// path, or an MCP method naming a tool directly (upgraded to mcp:// once the server lists
// it). Any other scheme, webmcp:// included, is not.
func IsMCPServerEndpoint(method, path string) bool {
	if strings.HasPrefix(path, "mcp://") {
		return true
	}
	if strings.Contains(path, "://") {
		return false
	}
	switch method {
	case "CALL", "MCP", "READ", "PROMPT":
		return true
	}
	return false
}
