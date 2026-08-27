// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package mcp

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"strings"

	"swazz-engine/internal/swagger"
)

// Client interface defines the contract for MCP transport clients.
// This interface is exported to allow for dependency injection and testing.
type Client interface {
	// Connect establishes connection with the MCP server
	Connect(ctx context.Context) error
	// ListTools retrieves the list of available tools
	ListTools(ctx context.Context) ([]Tool, error)
	// CallTool invokes a tool on the MCP server. extraHeaders are applied on top
	// of the client's base headers for this one call only, so a caller can invoke
	// the same tool as a different identity (BOLA/IDOR) without a second client.
	// Pass nil for the default identity.
	CallTool(ctx context.Context, name string, arguments map[string]any, extraHeaders map[string]string) (*CallToolResult, string, error)
	// ListResources retrieves the list of available resources
	ListResources(ctx context.Context) ([]Resource, error)
	// ReadResource reads a resource by URI. extraHeaders can override authorization headers.
	ReadResource(ctx context.Context, uri string, extraHeaders map[string]string) (*ReadResourceResult, string, error)
	// ListPrompts retrieves the list of available prompt templates
	ListPrompts(ctx context.Context) ([]Prompt, error)
	// GetPrompt evaluates/fetches a prompt template with the provided arguments.
	GetPrompt(ctx context.Context, name string, arguments map[string]any, extraHeaders map[string]string) (*GetPromptResult, string, error)
	// Close terminates the connection
	Close() error
}

// Resource represents a resource exposed by the MCP server.
type Resource struct {
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	MIMEType    string `json:"mimeType,omitempty"`
}

// ReadResourceResult represents the result of a resources/read call.
type ReadResourceResult struct {
	Contents []ResourceContent `json:"contents"`
	RawJSON  []byte            `json:"-"`
}

// ResourceContent represents the content payload of a read resource.
type ResourceContent struct {
	URI      string `json:"uri"`
	MIMEType string `json:"mimeType,omitempty"`
	Text     string `json:"text,omitempty"`
	Blob     string `json:"blob,omitempty"`
}

// Prompt represents a prompt template exposed by the MCP server.
type Prompt struct {
	Name        string           `json:"name"`
	Description string           `json:"description,omitempty"`
	Arguments   []PromptArgument `json:"arguments,omitempty"`
}

// PromptArgument represents a parameter of a prompt template.
type PromptArgument struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required,omitempty"`
}

// GetPromptResult represents the result of a prompts/get call.
type GetPromptResult struct {
	Description string          `json:"description,omitempty"`
	Messages    []PromptMessage `json:"messages"`
	RawJSON     []byte          `json:"-"`
}

// PromptMessage represents a message returned in a prompt template.
type PromptMessage struct {
	Role    string        `json:"role"`
	Content PromptContent `json:"content"`
}

// PromptContent represents text or resource embedded in a prompt message.
type PromptContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// Tool represents a tool configuration exposed by the MCP server.
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	InputSchema swagger.SchemaProperty `json:"inputSchema"`

	// Meta and Annotations carry the two blocks a server can use to declare how
	// dangerous a tool is: the MCP spec's own hints live in `annotations`, while
	// a deployment may put its own contract in `_meta` (e.g. requires_confirmation
	// / requires_2fa_confirmation). Kept raw so this package does not have to take
	// a position on either schema.
	Meta        json.RawMessage `json:"_meta,omitempty"`
	Annotations json.RawMessage `json:"annotations,omitempty"`
}

// ConfirmationFlags reports the confirmation requirements the server declared for
// this tool, and which block they came from ("_meta", "annotations", or "" when
// the tool declares neither). `_meta` wins when both carry a value.
//
// A tool that declares nothing is not the same as a tool that declares false: the
// empty source is what tells a caller the contract is simply absent.
func (t Tool) ConfirmationFlags() (requiresConfirmation, requires2FA bool, source string) {
	blocks := []struct {
		name string
		raw  json.RawMessage
	}{
		{"_meta", t.Meta},
		{"annotations", t.Annotations},
	}

	for _, b := range blocks {
		if len(b.raw) == 0 {
			continue
		}
		var flags struct {
			RequiresConfirmation *bool `json:"requires_confirmation"`
			Requires2FA          *bool `json:"requires_2fa_confirmation"`
		}
		if err := json.Unmarshal(b.raw, &flags); err != nil {
			continue
		}
		if flags.RequiresConfirmation == nil && flags.Requires2FA == nil {
			continue
		}
		return flags.RequiresConfirmation != nil && *flags.RequiresConfirmation,
			flags.Requires2FA != nil && *flags.Requires2FA,
			b.name
	}

	return false, false, ""
}

// NewClientFromConfig builds the transport described by cfg, folding the run's
// global headers and cookies into the request headers. Shared by the runner and
// by `start -mcp-list-tools` so both reach the server identically.
func NewClientFromConfig(
	cfg *swagger.MCPServerConfig,
	globalHeaders, cookies map[string]string,
	allowPrivateIPs bool,
	tlsConfig *tls.Config,
) (Client, error) {
	if cfg == nil {
		return nil, fmt.Errorf("no mcp_server configured")
	}

	headers := make(map[string]string, len(globalHeaders)+1)
	for k, v := range globalHeaders {
		headers[k] = v
	}
	if len(cookies) > 0 {
		parts := make([]string, 0, len(cookies))
		for k, v := range cookies {
			parts = append(parts, fmt.Sprintf("%s=%s", k, v))
		}
		headers["Cookie"] = strings.Join(parts, "; ")
	}

	switch cfg.Type {
	case "stdio":
		return NewStdioClient(cfg.Command, cfg.Args), nil
	case "sse":
		return NewSSEClient(cfg.URL, allowPrivateIPs, headers, tlsConfig), nil
	case "http":
		return NewHTTPClient(cfg.URL, allowPrivateIPs, headers), nil
	default:
		return nil, fmt.Errorf("unsupported mcp_server type %q (want stdio, sse or http)", cfg.Type)
	}
}

// CallToolResult represents the outcome of invoking an MCP tool.
type CallToolResult struct {
	Content []Content `json:"content"`
	IsError bool      `json:"isError,omitempty"`
	RawJSON []byte    `json:"-"`
}

// Content defines a single item in the CallToolResult content array.
type Content struct {
	Type string `json:"type"` // "text", "image", "resource"
	Text string `json:"text,omitempty"`
}
