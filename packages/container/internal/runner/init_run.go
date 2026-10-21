// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package runner

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	swazzGrpc "swazz-engine/internal/grpc"
	"swazz-engine/internal/logger"
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

// allowPrivateIPs reports whether this run may reach private and reserved addresses; without a
// config it may not.
func (r *Runner) allowPrivateIPs() bool {
	return r.config != nil && r.config.Security.AllowPrivateIPs
}

func (r *Runner) getGRPCClient(addr string, isTLS bool, md map[string]string) *swazzGrpc.Client {
	if val, ok := r.grpcClients.Load(addr); ok {
		if c, ok := val.(*swazzGrpc.Client); ok {
			return c
		}
	}
	c := swazzGrpc.NewClient(addr, isTLS, md, r.allowPrivateIPs())
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

	r.oobStore.Clear()
	r.sstiStore.Clear()
	r.userLogRepeats.reset()
	r.workerPanicked.Store(false)

	ctx, cancel := context.WithCancel(parentCtx)
	r.lifecycle.cancel = cancel

	// Connect to the MCP server if configured. An unreachable MCP server costs only its own part
	// of the scan: the rest is scanned as usual, with a warning in the runner log saying why the
	// MCP part was skipped and what to change. Only a scan with nothing else to scan fails.
	if r.mcpClient != nil {
		logger.Info("[Runner] Connecting to MCP Server...")
		if err := r.prepareMCP(ctx); err != nil {
			_ = r.mcpClient.Close()
			r.mcpClient = nil
			// The user sees this (runner log, failure reason): Go's HTTP errors quote the full
			// URL, whose query or userinfo may carry the MCP server's token.
			reason := redactURLs(err.Error())
			kept, skipped := withoutMCPEndpoints(r.config.Endpoints)
			if len(kept) == 0 {
				r.logError("[MCP] ❌ %s. The MCP server is the only target of this scan, so the scan cannot run. %s", reason, mcpFixHint)
				cancel()
				r.lifecycle.isRunning.Store(false)
				return nil, errors.New(reason)
			}
			r.config.Endpoints = kept
			r.logWarn("[MCP] ⚠️ %s. The MCP part of the scan is skipped (%d MCP endpoint(s)); everything else is scanned as usual. %s", reason, skipped, mcpFixHint)
		}
	}
	r.logScanTargets()

	go r.statsAggregator()

	r.resultsMu.Lock()
	r.allResults = nil
	r.resultsMu.Unlock()

	return ctx, nil
}

// workerStopTimeout bounds how long a run that ended abnormally waits for its workers.
const workerStopTimeout = 30 * time.Second

// goWorker runs fn as one of the run's workers. A panic in it (an analyzer, a generator, an
// executor) must not take the agent and every other run on it down: it is logged locally,
// stack included, and stops this run, which then ends with an error (see Start).
func (r *Runner) goWorker(fn func()) {
	r.workers.Add(1)
	go func() {
		defer r.workers.Done()
		defer func() {
			if p := recover(); p != nil {
				logger.Error("[Runner] A worker panicked: %v\n%s", p, debug.Stack())
				r.workerPanicked.Store(true)
				r.cancelRun()
			}
		}()
		fn()
	}()
}

func (r *Runner) cancelRun() {
	r.lifecycle.mu.Lock()
	if r.lifecycle.cancel != nil {
		r.lifecycle.cancel()
	}
	r.lifecycle.mu.Unlock()
}

// waitWorkers waits for the run's workers to return, at most timeout; false if they did not.
func (r *Runner) waitWorkers(timeout time.Duration) bool {
	done := make(chan struct{})
	go func() {
		r.workers.Wait()
		close(done)
	}()
	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}

// RunPanicMessage is what the user is told when the run panicked: no internals.
const RunPanicMessage = "The runner hit an internal error and stopped the scan. Start it again; if this keeps happening, update the runner or report the issue."

// finaliseRun is deferred in Start() to cancel the run context, drain stats,
// update the lifecycle flag, and broadcast the completion event.
func (r *Runner) finaliseRun() {
	r.finalise(false)
}

// finaliseRunAfterPanic finalises a run that panicked: it ends with an error, not "complete".
func (r *Runner) finaliseRunAfterPanic() {
	r.finalise(true)
}

func (r *Runner) finalise(panicked bool) {
	r.cancelRun()

	// Workers send to statsChan: closing it under one still running would panic it ("send on
	// closed channel"). On a normal end they have all returned; after a panic they stop on the
	// cancelled context, within a bound (a request in flight has its own timeout).
	if r.waitWorkers(workerStopTimeout) {
		// Signal stats aggregator to flush and exit.
		close(r.statsChan)
		<-r.statsDone
	} else {
		logger.Error("[Runner] Workers still running %v after the run ended; leaving their stats channel open", workerStopTimeout)
	}

	r.lifecycle.isRunning.Store(false)

	final := r.GetStats()
	final.IsRunning = false
	final.Progress.CurrentEndpoint = ""
	final.Progress.CurrentProfile = ""
	r.latestStats.Store(&final)
	r.logSuppressedSummary()
	if panicked {
		r.Broadcast(Event{Type: EventError, Data: RunPanicMessage})
	} else {
		r.Broadcast(Event{Type: EventComplete, Data: final})
		r.logCompletionSummary(final)
	}

	if r.mcpClient != nil {
		_ = r.mcpClient.Close()
	}
	r.sstiStore.Clear()
	r.oobStore.Clear()
}

// mcpFixHint tells the user what to change when the MCP server cannot be used.
const mcpFixHint = "Check the MCP server URL and its credentials (Global Headers), or remove the MCP server in Project Settings if it should not be scanned."

// prepareMCP connects to the MCP server and adds its tools, resources, prompts and probes to the
// scan as configured. An error means the MCP part of the scan cannot run.
func (r *Runner) prepareMCP(ctx context.Context) error {
	if err := r.mcpClient.Connect(ctx); err != nil {
		return fmt.Errorf("could not connect to the MCP server: %w", err)
	}

	// Any MCP tool the user configured, the server's or a browser WebMCP one, makes the config
	// an allowlist: the server's other tools are then not added.
	hasAnyMcpInConfig := false
	for _, ep := range r.config.Endpoints {
		if isMCPEndpoint(ep) || swagger.IsWebMCPEndpoint(ep.Path) {
			hasAnyMcpInConfig = true
			break
		}
	}

	if r.config.Settings.MCPFuzzToolsEnabled() {
		logger.Info("[Runner] Listing MCP Tools...")
		tools, err := r.mcpClient.ListTools(ctx)
		if err != nil {
			return fmt.Errorf("could not list the MCP server's tools: %w", err)
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
	}

	if r.config.Settings.MCPFuzzResourcesEnabled() {
		resources, resErr := r.mcpClient.ListResources(ctx)
		if resErr == nil && len(resources) > 0 {
			logger.Info("[Runner] Found %d MCP Resources", len(resources))
			for _, res := range resources {
				resPath := "mcp://resource/" + res.URI
				if !hasAnyMcpInConfig {
					r.config.Endpoints = append(r.config.Endpoints, swagger.EndpointConfig{
						Path:   resPath,
						Method: "READ",
						Schema: swagger.SchemaProperty{
							Type: "object",
							Properties: map[string]*swagger.SchemaProperty{
								"uri": {Type: "string"},
							},
						},
						ContentType: "application/json",
					})
				}
			}
		}
	}

	if r.config.Settings.MCPFuzzPromptsEnabled() {
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
	}

	if r.config.Settings.MCPMethodFuzzingEnabled() {
		if r.config.Settings.MCPFuzzToolsEnabled() {
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
		}
		// Resource traversal and SSRF probes
		if r.config.Settings.MCPFuzzResourcesEnabled() {
			resourceProbes := []string{
				"file:///etc/passwd",
				"file:///etc/shadow",
				"file:///C:/Windows/win.ini",
				"http://169.254.169.254/latest/meta-data/",
				"internal://secrets/config",
			}
			for _, rp := range resourceProbes {
				r.config.Endpoints = append(r.config.Endpoints, swagger.EndpointConfig{
					Path:   "mcp://resource/" + rp,
					Method: "READ",
					Schema: swagger.SchemaProperty{
						Type: "object",
						Properties: map[string]*swagger.SchemaProperty{
							"uri": {Type: "string"},
						},
					},
					ContentType: "application/json",
				})
			}
		}
		// Prompt injection and reflection probes
		if r.config.Settings.MCPFuzzPromptsEnabled() {
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
	return nil
}

// isMCPEndpoint reports whether the endpoint is served by the MCP server (not WebMCP).
func isMCPEndpoint(ep swagger.EndpointConfig) bool {
	return swagger.IsMCPServerEndpoint(ep.Method, ep.Path)
}

// withoutMCPEndpoints returns the endpoints not served by the MCP server, and how many were.
func withoutMCPEndpoints(eps []swagger.EndpointConfig) ([]swagger.EndpointConfig, int) {
	kept := make([]swagger.EndpointConfig, 0, len(eps))
	for _, ep := range eps {
		if !isMCPEndpoint(ep) {
			kept = append(kept, ep)
		}
	}
	return kept, len(eps) - len(kept)
}

// logScanTargets tells the user up front what this scan covers, so a part they did not expect
// (an MCP server left in the project settings) is visible before it matters.
func (r *Runner) logScanTargets() {
	api, mcpCount := 0, 0
	for _, ep := range r.config.Endpoints {
		if isMCPEndpoint(ep) {
			mcpCount++
		} else {
			api++
		}
	}
	msg := fmt.Sprintf("Scan targets: %d API endpoint(s)", api)
	if r.mcpClient != nil {
		msg += fmt.Sprintf(", MCP server %s with %d endpoint(s)", mcpServerLabel(r.config.MCPServer), mcpCount)
	}
	r.logInfo("%s", msg)
}

// urlInText finds URLs inside free text (error messages).
var urlInText = regexp.MustCompile(`[A-Za-z][A-Za-z0-9+.-]*://[^\s"'<>]+`)

// redactURLs keeps each URL in text down to scheme and host: userinfo, path, query and fragment
// may carry credentials (hosted MCP servers often put the key in the path) and become "…".
func redactURLs(text string) string {
	return urlInText.ReplaceAllStringFunc(text, func(raw string) string {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" {
			return "(URL)"
		}
		out := u.Scheme + "://"
		if u.User != nil {
			out += "…@"
		}
		out += u.Host
		if p := u.EscapedPath(); p != "" && p != "/" {
			out += "/…"
		}
		if u.RawQuery != "" || u.ForceQuery {
			out += "?…"
		}
		if u.Fragment != "" {
			out += "#…"
		}
		return out
	})
}

// mcpServerLabel names the MCP server for the user: its host, never its full URL (which may
// carry a token) or its command line (which may carry secrets).
func mcpServerLabel(cfg *swagger.MCPServerConfig) string {
	if cfg == nil {
		return ""
	}
	if cfg.URL != "" {
		if u, err := url.Parse(cfg.URL); err == nil && u.Host != "" {
			return u.Host
		}
		return "(invalid URL)"
	}
	return "(local command)"
}
