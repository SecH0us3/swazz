// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"swazz-engine/internal/mcp"
	"swazz-engine/internal/swagger"
)

const mcpToolPathPrefix = "mcp://tool/"

// listMCPTools connects to the configured MCP server, prints its tool catalogue
// and exits without fuzzing anything. It exists because you cannot write a safe
// allowlist before you know what the server exposes, and asking the server is the
// only way to find out — the names are not in any spec file.
//
// Read-only by construction: initialize + tools/list, never tools/call.
func listMCPTools(runCfg *swagger.Config) error {
	client, err := mcp.NewClientFromConfig(
		runCfg.MCPServer, runCfg.GlobalHeaders, runCfg.Cookies,
		runCfg.Security.AllowPrivateIPs, nil)
	if err != nil {
		return fmt.Errorf("-mcp-list-tools: %w", err)
	}
	defer func() { _ = client.Close() }()

	timeout := 30 * time.Second
	if runCfg.Settings.TimeoutMs > 0 {
		timeout = time.Duration(runCfg.Settings.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if err := client.Connect(ctx); err != nil {
		return fmt.Errorf("failed to connect to MCP server: %w", err)
	}
	tools, err := client.ListTools(ctx)
	if err != nil {
		return fmt.Errorf("failed to list MCP tools: %w", err)
	}

	allowed := allowlistedTools(runCfg.Endpoints)

	target := "(stdio)"
	if runCfg.MCPServer.URL != "" {
		target = runCfg.MCPServer.URL
	}
	fmt.Printf("\nMCP server: %s (%s)\n", target, runCfg.MCPServer.Type)

	if len(tools) == 0 {
		fmt.Println("\nThe server returned an empty tool catalogue.")
		fmt.Println("That is a signal, not a no-op: it also happens when one malformed")
		fmt.Println("upstream annotation breaks tools/list, or a cold start cached an")
		fmt.Println("empty catalogue. Check the server before concluding there is")
		fmt.Println("nothing to test.")
		return nil
	}

	sorted := make([]mcp.Tool, len(tools))
	copy(sorted, tools)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Name < sorted[j].Name })

	fmt.Printf("%d tool(s)\n\n", len(sorted))

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "IN SCOPE\tCONFIRM\t2FA\tDECLARED IN\tTOOL")
	fmt.Fprintln(w, "--------\t-------\t---\t-----------\t----")

	var unlisted, risky []string
	for _, t := range sorted {
		confirm, twoFA, source := t.ConfirmationFlags()
		inScope := "-"
		if allowed[t.Name] {
			inScope = "yes"
		} else {
			unlisted = append(unlisted, t.Name)
		}
		if source == "" {
			source = "(nothing)"
		}
		if allowed[t.Name] && (confirm || twoFA) {
			risky = append(risky, t.Name)
		}
		fmt.Fprintf(w, "%s\t%v\t%v\t%s\t%s\n", inScope, confirm, twoFA, source, t.Name)
	}
	_ = w.Flush()

	fmt.Printf("\n%d of %d tool(s) are in scope. Only these are fuzzed — a tool absent\n",
		len(sorted)-len(unlisted), len(sorted))
	fmt.Println("from endpoint_definitions is never called.")

	if len(allowed) == 0 {
		fmt.Println("\n!! endpoint_definitions names no MCP tool, so EVERY tool above will be")
		fmt.Println("!! fuzzed, write tools included. Add the ones you want before running")
		fmt.Println("!! without -mcp-list-tools.")
	}

	if len(risky) > 0 {
		fmt.Printf("\n!! In scope but declaring a confirmation requirement: %s\n",
			strings.Join(risky, ", "))
		fmt.Println("!! The server itself says these need explicit user confirmation, which")
		fmt.Println("!! means they change state. Remove them unless you meant it.")
	}

	fmt.Println("\nA tool declaring nothing under CONFIRM/2FA has not been reviewed as safe —")
	fmt.Println("it has simply not declared a contract. Judge those by hand.")

	if len(unlisted) > 0 {
		fmt.Printf("\nendpoint_definitions entries for the %d tool(s) not yet in scope:\n\n",
			len(unlisted))
		fmt.Println(allowlistSnippet(unlisted))
		fmt.Println("Keep only the ones you are willing to have fuzzed.")
	}

	return nil
}

// allowlistedTools returns the MCP tool names the config puts in scope.
func allowlistedTools(endpoints []swagger.EndpointConfig) map[string]bool {
	allowed := make(map[string]bool)
	for _, ep := range endpoints {
		if name := strings.TrimPrefix(ep.Path, mcpToolPathPrefix); name != ep.Path {
			allowed[name] = true
		}
	}
	return allowed
}

// allowlistSnippet renders a paste-ready endpoint_definitions block.
func allowlistSnippet(names []string) string {
	width := 0
	for _, n := range names {
		if l := len(n) + len(mcpToolPathPrefix) + 3; l > width {
			width = l
		}
	}

	var b strings.Builder
	b.WriteString("\"endpoint_definitions\": [\n")
	for i, n := range names {
		path := fmt.Sprintf("%q,", mcpToolPathPrefix+n)
		comma := ","
		if i == len(names)-1 {
			comma = ""
		}
		fmt.Fprintf(&b, "  { \"path\": %-*s \"method\": \"CALL\", \"contentType\": \"application/json\" }%s\n",
			width, path, comma)
	}
	b.WriteString("],")

	return b.String()
}
