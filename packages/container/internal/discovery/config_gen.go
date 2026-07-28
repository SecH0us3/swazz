package discovery

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"swazz-engine/internal/swagger"
)

// DiscoveryConfig controls how auto-generated scan configs are built.
type DiscoveryConfig struct {
	Profiles             []string
	Concurrency          int
	IterationsPerProfile int
	CoordinatorURL       string
	WebhookURL           string
	OutputDir            string
}

// ScanConfig is the auto-generated config written to disk for swazz-engine start.
type ScanConfig struct {
	BaseURL    string                   `json:"base_url"`
	MCPServer  *swagger.MCPServerConfig `json:"mcp_server,omitempty"`
	Settings   swagger.Settings         `json:"settings"`
	Security   swagger.SecurityConfig   `json:"security,omitempty"`
	WebhookURL string                   `json:"webhook_url,omitempty"`
}

// GenerateConfig builds a ScanConfig struct ready for the Swazz runner from a probed MCP server.
func GenerateConfig(server ProbedServer, opts DiscoveryConfig) (*ScanConfig, error) {
	if len(server.Tools) == 0 {
		return nil, fmt.Errorf("server %s/%s has no tools to fuzz", server.Namespace, server.Name)
	}

	profiles := opts.Profiles
	if len(profiles) == 0 {
		profiles = []string{"BOUNDARY", "MALICIOUS"}
	}
	fuzzProfiles := make([]swagger.FuzzingProfile, len(profiles))
	for i, p := range profiles {
		fuzzProfiles[i] = swagger.FuzzingProfile(p)
	}

	concurrency := opts.Concurrency
	if concurrency <= 0 {
		concurrency = 5
	}
	iterations := opts.IterationsPerProfile
	if iterations <= 0 {
		iterations = 10
	}

	baseURL := fmt.Sprintf("http://%s:%d", server.Host, server.Port)
	mcpURL := server.InClusterURL()

	cfg := &ScanConfig{
		BaseURL: baseURL,
		MCPServer: &swagger.MCPServerConfig{
			Type: server.Transport,
			URL:  mcpURL,
		},
		Settings: swagger.Settings{
			Profiles:             fuzzProfiles,
			Concurrency:          concurrency,
			IterationsPerProfile: iterations,
		},
		Security: swagger.SecurityConfig{
			AllowPrivateIPs: true, // in-cluster scanning always uses private IPs
		},
	}

	if opts.WebhookURL != "" {
		cfg.WebhookURL = opts.WebhookURL
	}

	return cfg, nil
}

// GenerateConfigFile writes a ScanConfig as JSON to the output directory.
// Returns the full path to the written file.
func GenerateConfigFile(server ProbedServer, opts DiscoveryConfig, outputDir string) (string, error) {
	cfg, err := GenerateConfig(server, opts)
	if err != nil {
		return "", err
	}

	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", fmt.Errorf("creating output dir: %w", err)
	}

	filename := fmt.Sprintf("%s_%s.json", server.Namespace, server.Name)
	path := filepath.Join(outputDir, filename)

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshaling config: %w", err)
	}

	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("writing config to %s: %w", path, err)
	}

	return path, nil
}
