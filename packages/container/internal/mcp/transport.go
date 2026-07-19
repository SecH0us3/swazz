package mcp

import (
	"context"
	"swazz-engine/internal/swagger"
)

// Client interface defines the contract for MCP transport clients.
// This interface is exported to allow for dependency injection and testing.
type Client interface {
	// Connect establishes connection with the MCP server
	Connect(ctx context.Context) error
	// ListTools retrieves the list of available tools
	ListTools(ctx context.Context) ([]Tool, error)
	// CallTool invokes a tool on the MCP server
	CallTool(ctx context.Context, name string, arguments map[string]any) (*CallToolResult, string, error)
	// Close terminates the connection
	Close() error
}

// Tool represents a tool configuration exposed by the MCP server.
type Tool struct {
	Name        string             `json:"name"`
	Description string             `json:"description,omitempty"`
	InputSchema swagger.SchemaProperty `json:"inputSchema"`
}

// CallToolResult represents the outcome of invoking an MCP tool.
type CallToolResult struct {
	Content []Content `json:"content"`
	IsError bool      `json:"isError,omitempty"`
}

// Content defines a single item in the CallToolResult content array.
type Content struct {
	Type string `json:"type"` // "text", "image", "resource"
	Text string `json:"text,omitempty"`
}
