// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"fmt"
	"strings"
	"sync"

	swazzGrpc "swazz-engine/internal/grpc"
	"swazz-engine/internal/logger"
	"swazz-engine/internal/oob"
	"swazz-engine/internal/sstistore"
	"swazz-engine/internal/swagger"
)

var mcpMethodProbes = []string{
	"__proto__",
	"constructor",
	"prototype",
	"__class__",
	"__dict__",
	"__globals__",
	"../../../etc/passwd",
	"..\\..\\..\\windows\\win.ini",
	"debug/eval",
	"admin/config",
	"system/exec",
	"rpc.discover",
	"tool\x00inject",
	"' OR '1'='1",
	"; id ;",
}

func (r *Runner) getGRPCClient(addr string, isTLS bool, md map[string]string) *swazzGrpc.Client {
	if val, ok := r.grpcClients.Load(addr); ok {
		if c, ok := val.(*swazzGrpc.Client); ok {
			return c
		}
	}
	c := swazzGrpc.NewClient(addr, isTLS, md)
	actual, _ := r.grpcClients.LoadOrStore(addr, c)
	if client, ok := actual.(*swazzGrpc.Client); ok {
		return client
	}
	return c
}

// initRun validates that no run is active, initialises all per-run state, and
// returns a new context that is cancelled when Stop() is called.
func (r *Runner) initRun(parentCtx context.Context) (context.Context, error) {
	r.lifecycle.mu.Lock()
	defer r.lifecycle.mu.Unlock()

	if r.lifecycle.isRunning.Load() {
		return nil, fmt.Errorf("already running")
	}

	r.lifecycle.isRunning.Store(true)
	r.lifecycle.isPaused.Store(false)
	r.lifecycle.shouldStop.Store(false)

	// Re-create channels (may have been closed by a previous run).
	r.statsChan = make(chan statsMsg, 4096)
	r.statsDone = make(chan struct{})

	empty := newEmptyStats()
	r.latestStats.Store(&empty)
	r.sizeBaselines = &sync.Map{}
	r.timeBaselines = &sync.Map{}

	oob.GlobalStore.Clear()
	sstistore.GlobalStore.Clear()

	ctx, cancel := context.WithCancel(parentCtx)
	r.lifecycle.cancel = cancel

	// Connect to MCP Server if configured
	if r.mcpClient != nil {
		logger.Info("[Runner] Connecting to MCP Server...")
		if err := r.mcpClient.Connect(ctx); err != nil {
			logger.Error("[Runner] Failed to connect to MCP server: %v", err)
			cancel()
			r.lifecycle.isRunning.Store(false)
			return nil, fmt.Errorf("failed to connect to MCP server: %w", err)
		}

		logger.Info("[Runner] Listing MCP Tools...")
		tools, err := r.mcpClient.ListTools(ctx)
		if err != nil {
			logger.Error("[Runner] Failed to list MCP tools: %v", err)
			_ = r.mcpClient.Close()
			cancel()
			r.lifecycle.isRunning.Store(false)
			return nil, fmt.Errorf("failed to list MCP tools: %w", err)
		}

		hasAnyMcpInConfig := false
		for _, ep := range r.config.Endpoints {
			if ep.Method == "CALL" || ep.Method == "MCP" || strings.HasPrefix(ep.Path, "mcp://tool/") {
				hasAnyMcpInConfig = true
				break
			}
		}

		logger.Info("[Runner] Found %d MCP Tools", len(tools))
		var skipped []string
		for _, tool := range tools {
			toolPath := "mcp://tool/" + tool.Name

			// Check if this tool is already in r.config.Endpoints (either with mcp://tool/ prefix or raw name)
			foundIndex := -1
			for i, ep := range r.config.Endpoints {
				if ep.Path == toolPath || ep.Path == tool.Name {
					foundIndex = i
					break
				}
			}

			if foundIndex != -1 {
				logger.Info("[Runner] Upgrading MCP tool in-place: %s", tool.Name)
				r.config.Endpoints[foundIndex].Path = toolPath
				r.config.Endpoints[foundIndex].Method = "CALL"
				r.config.Endpoints[foundIndex].Schema = tool.InputSchema
				r.config.Endpoints[foundIndex].ContentType = "application/json"
			} else if !hasAnyMcpInConfig {
				logger.Info("[Runner] Mapping new MCP tool: %s", tool.Name)
				ep := swagger.EndpointConfig{
					Path:        toolPath,
					Method:      "CALL",
					Schema:      tool.InputSchema,
					ContentType: "application/json",
				}
				r.config.Endpoints = append(r.config.Endpoints, ep)
			} else {
				// The config names its own MCP tools, so this one is deliberately
				// out of scope. Say so by name — a silent skip looks identical to
				// a tool that does not exist, which is how a typo in the allowlist
				// turns into "the scan passed".
				skipped = append(skipped, tool.Name)
			}
		}

		if len(skipped) > 0 {
			logger.Info("[Runner] Skipping %d MCP tool(s) not in the config allowlist: %s",
				len(skipped), strings.Join(skipped, ", "))
		}

		resources, resErr := r.mcpClient.ListResources(ctx)
		if resErr == nil && len(resources) > 0 {
			logger.Info("[Runner] Found %d MCP Resources", len(resources))
			for _, res := range resources {
				resPath := "mcp://resource/" + res.URI
				if !hasAnyMcpInConfig {
					r.config.Endpoints = append(r.config.Endpoints, swagger.EndpointConfig{
						Path:        resPath,
						Method:      "READ",
						Schema:      swagger.SchemaProperty{Type: "object"},
						ContentType: "application/json",
					})
				}
			}
		}

		prompts, promptErr := r.mcpClient.ListPrompts(ctx)
		if promptErr == nil && len(prompts) > 0 {
			logger.Info("[Runner] Found %d MCP Prompts", len(prompts))
			for _, pr := range prompts {
				promptPath := "mcp://prompt/" + pr.Name
				if !hasAnyMcpInConfig {
					props := make(map[string]*swagger.SchemaProperty, len(pr.Arguments))
					var required []string
					for _, arg := range pr.Arguments {
						props[arg.Name] = &swagger.SchemaProperty{
							Type: "string",
						}
						if arg.Required {
							required = append(required, arg.Name)
						}
					}
					r.config.Endpoints = append(r.config.Endpoints, swagger.EndpointConfig{
						Path:   promptPath,
						Method: "PROMPT",
						Schema: swagger.SchemaProperty{
							Type:       "object",
							Properties: props,
							Required:   required,
						},
						ContentType: "application/json",
					})
				}
			}
		}

		if r.config.Settings.MCPMethodFuzzingEnabled() {
			logger.Info("[Runner] MCP Method & Tool Name Fuzzing enabled: appending %d dispatch probe endpoints", len(mcpMethodProbes))
			for _, probe := range mcpMethodProbes {
				toolPath := "mcp://tool/" + probe
				r.config.Endpoints = append(r.config.Endpoints, swagger.EndpointConfig{
					Path:        toolPath,
					Method:      "CALL",
					Schema:      swagger.SchemaProperty{Type: "object"},
					ContentType: "application/json",
				})
			}
			// Resource traversal and SSRF probes
			resourceProbes := []string{
				"file:///etc/passwd",
				"file:///etc/shadow",
				"file:///C:/Windows/win.ini",
				"http://169.254.169.254/latest/meta-data/",
				"internal://secrets/config",
			}
			for _, rp := range resourceProbes {
				r.config.Endpoints = append(r.config.Endpoints, swagger.EndpointConfig{
					Path:        "mcp://resource/" + rp,
					Method:      "READ",
					Schema:      swagger.SchemaProperty{Type: "object"},
					ContentType: "application/json",
				})
			}
			// Prompt injection and reflection probes
			promptProbes := []string{
				"__proto__",
				"__class__",
				"system/prompt",
				"debug/instructions",
			}
			for _, pp := range promptProbes {
				r.config.Endpoints = append(r.config.Endpoints, swagger.EndpointConfig{
					Path:        "mcp://prompt/" + pp,
					Method:      "PROMPT",
					Schema:      swagger.SchemaProperty{Type: "object"},
					ContentType: "application/json",
				})
			}
		}
	}

	go r.statsAggregator()

	r.resultsMu.Lock()
	r.allResults = nil
	r.resultsMu.Unlock()

	return ctx, nil
}

// finaliseRun is deferred in Start() to cancel the run context, drain stats,
// update the lifecycle flag, and broadcast the completion event.
func (r *Runner) finaliseRun() {
	r.lifecycle.mu.Lock()
	if r.lifecycle.cancel != nil {
		r.lifecycle.cancel()
	}
	r.lifecycle.mu.Unlock()

	// Signal stats aggregator to flush and exit.
	close(r.statsChan)
	<-r.statsDone

	r.lifecycle.isRunning.Store(false)

	final := r.GetStats()
	final.IsRunning = false
	final.Progress.CurrentEndpoint = ""
	final.Progress.CurrentProfile = ""
	r.latestStats.Store(&final)
	r.Broadcast(Event{Type: EventComplete, Data: final})

	if r.mcpClient != nil {
		_ = r.mcpClient.Close()
	}
	sstistore.GlobalStore.Clear()
	oob.GlobalStore.ClearSession(r.config.RunID)
}
