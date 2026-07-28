package discovery

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/mcp"
	"swazz-engine/internal/swagger"
)

func TestGenerateConfig_ProducesValidConfig(t *testing.T) {
	server := ProbedServer{
		DiscoveredService: DiscoveredService{
			Name:      "payment-mcp",
			Namespace: "prod",
			Host:      "payment-mcp.prod.svc.cluster.local",
			Port:      8080,
			Endpoint:  "/mcp",
			Transport: "http",
		},
		ServerName: "payment-service",
		Tools: []mcp.Tool{
			{
				Name:        "charge_card",
				Description: "Charge a credit card",
				InputSchema: swagger.SchemaProperty{
					Type: "object",
					Properties: map[string]*swagger.SchemaProperty{
						"card_number": {Type: "string"},
						"amount":      {Type: "number"},
					},
				},
			},
		},
	}

	cfg, err := GenerateConfig(server, DiscoveryConfig{
		Profiles:             []string{"BOUNDARY", "MALICIOUS"},
		Concurrency:          3,
		IterationsPerProfile: 10,
	})
	require.NoError(t, err)
	assert.Equal(t, "http://payment-mcp.prod.svc.cluster.local:8080", cfg.BaseURL)
	assert.NotNil(t, cfg.MCPServer)
	assert.Equal(t, "http", cfg.MCPServer.Type)
	assert.Equal(t, "http://payment-mcp.prod.svc.cluster.local:8080/mcp", cfg.MCPServer.URL)
	assert.Equal(t, 3, cfg.Settings.Concurrency)
	assert.Contains(t, cfg.Settings.Profiles, swagger.FuzzingProfile("MALICIOUS"))
}

func TestGenerateConfig_NoTools_ReturnsError(t *testing.T) {
	server := ProbedServer{
		DiscoveredService: DiscoveredService{
			Name:      "empty-mcp",
			Namespace: "prod",
			Host:      "empty-mcp.prod.svc.cluster.local",
			Port:      8080,
			Endpoint:  "/mcp",
			Transport: "http",
		},
		Tools: []mcp.Tool{},
	}

	cfg, err := GenerateConfig(server, DiscoveryConfig{})
	assert.Error(t, err)
	assert.Nil(t, cfg)
	assert.Contains(t, err.Error(), "no tools to fuzz")
}

func TestGenerateConfigFile_WritesJSON(t *testing.T) {
	server := ProbedServer{
		DiscoveredService: DiscoveredService{
			Name:      "test-mcp",
			Namespace: "default",
			Host:      "test-mcp.default.svc.cluster.local",
			Port:      8080,
			Endpoint:  "/mcp",
			Transport: "http",
		},
		Tools: []mcp.Tool{
			{Name: "ping", InputSchema: swagger.SchemaProperty{Type: "object"}},
		},
	}

	dir := t.TempDir()
	path, err := GenerateConfigFile(server, DiscoveryConfig{}, dir)
	require.NoError(t, err)
	assert.FileExists(t, path)
	assert.Equal(t, filepath.Join(dir, "default_test-mcp.json"), path)

	data, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Contains(t, string(data), "test-mcp.default.svc.cluster.local")
}
