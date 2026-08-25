// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/license"
	"swazz-engine/internal/swagger"
)

func TestBuildRunnerConfig_ProtoFile(t *testing.T) {
	tmpDir := t.TempDir()
	protoPath := filepath.Join(tmpDir, "test.proto")
	protoSrc := `
syntax = "proto3";
package test;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
`
	require.NoError(t, os.WriteFile(protoPath, []byte(protoSrc), 0600))

	cliCfg := &CliConfig{
		BaseURL:     "grpc://localhost:50051",
		SwaggerURLs: []string{protoPath},
	}

	cfg, err := BuildRunnerConfig(cliCfg)
	require.NoError(t, err)
	require.NotNil(t, cfg)
	assert.Equal(t, "grpc://localhost:50051", cfg.BaseURL)
	require.Len(t, cfg.Endpoints, 1)
	assert.Equal(t, "/test.Greeter/SayHello", cfg.Endpoints[0].Path)
	assert.Equal(t, "GRPC", cfg.Endpoints[0].Method)
}

func TestBuildRunnerConfig_GRPCURL(t *testing.T) {
	cliCfg := &CliConfig{
		SwaggerURLs: []string{"grpc://127.0.0.1:59999"},
	}

	// Since 127.0.0.1:59999 is not running, it should return error discovering via reflection
	_, err := BuildRunnerConfig(cliCfg)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to discover gRPC service via reflection")
}

func TestRunCLIErr_ConfigValidation(t *testing.T) {
	// 1. Missing config file
	err := runCLIErr([]string{"-config", "nonexistent_config_file_123.json"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to read config file")

	// 2. Invalid JSON in config
	tmpDir := t.TempDir()
	invalidCfg := filepath.Join(tmpDir, "invalid.json")
	require.NoError(t, os.WriteFile(invalidCfg, []byte(`{invalid-json`), 0600))

	err = runCLIErr([]string{"-config", invalidCfg})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid config JSON")

	// 3. MCP list tools via CLI flag
	mcpCfg := filepath.Join(tmpDir, "mcp.json")
	require.NoError(t, os.WriteFile(mcpCfg, []byte(`{"base_url":"http://localhost:8080","mcp_server":{"type":"http","url":"http://127.0.0.1:1/mcp"}}`), 0600))
	err = runCLIErr([]string{"-config", mcpCfg, "-mcp-list-tools", "-debug", "-allow-private-ips=true"})
	assert.Error(t, err) // connection error to 127.0.0.1:1 proves listMCPTools was reached
}

func TestBuildRunnerConfig_OptionsAndValidation(t *testing.T) {
	// 1. Missing swagger_urls, endpoint_definitions, and mcp_server
	_, err := BuildRunnerConfig(&CliConfig{BaseURL: "http://example.com"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "config must specify at least one swagger_url")

	// 2. EndpointDefinitions fast path
	cfg, err := BuildRunnerConfig(&CliConfig{
		BaseURL: "http://example.com",
		EndpointDefinitions: []swagger.EndpointConfig{
			{Path: "/test", Method: "GET"},
		},
		GlobalHeaders: map[string]string{"X-Global": "1"},
		DisabledEndpoints: []string{"/disabled"},
	})
	assert.NoError(t, err)
	assert.NotNil(t, cfg)
	assert.Equal(t, "1", cfg.GlobalHeaders["X-Global"])

	// 3. MCPServer validation
	_, err = BuildRunnerConfig(&CliConfig{
		BaseURL: "http://example.com",
		MCPServer: &swagger.MCPServerConfig{
			Type: "invalid_type",
		},
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid mcp_server type")

	_, err = BuildRunnerConfig(&CliConfig{
		BaseURL: "http://example.com",
		MCPServer: &swagger.MCPServerConfig{
			Type:    "stdio",
			Command: "",
		},
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "mcp_server command cannot be empty")
}

func TestRunCLIErr_FullScanAndReports(t *testing.T) {
	pubKey, privKey, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	pubKeyHex := hex.EncodeToString(pubKey)
	origKey := license.DefaultPublicKeyHex
	license.DefaultPublicKeyHex = pubKeyHex
	defer func() { license.DefaultPublicKeyHex = origKey }()

	licPayload := &license.License{
		Company:   "TestCorp",
		ExpiresAt: time.Now().Add(24 * time.Hour),
		Features:  []string{license.FeatureReportExports},
	}
	token, err := license.GenerateToken(privKey, licPayload)
	require.NoError(t, err)

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"healthy"}`))
	}))
	defer ts.Close()

	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "config.json")
	sarifPath := filepath.Join(tmpDir, "report.sarif")
	jsonPath := filepath.Join(tmpDir, "report.json")
	htmlPath := filepath.Join(tmpDir, "report.html")
	junitPath := filepath.Join(tmpDir, "report.xml")
	mdPath := filepath.Join(tmpDir, "report.md")

	cfgJSON := fmt.Sprintf(`{
		"base_url": "%s",
		"license_key": "%s",
		"endpoint_definitions": [
			{"path": "/api/health", "method": "GET"}
		],
		"settings": {
			"iterations_per_profile": 1,
			"concurrency": 1,
			"timeout_ms": 2000,
			"profiles": ["RANDOM"]
		}
	}`, ts.URL, token)
	require.NoError(t, os.WriteFile(cfgPath, []byte(cfgJSON), 0600))

	err = runCLIErr([]string{
		"-config", cfgPath,
		"-sarif", sarifPath,
		"-json", jsonPath,
		"-html", htmlPath,
		"-junit", junitPath,
		"-markdown", mdPath,
		"-quiet",
		"-allow-private-ips=true",
		"-disable-telemetry",
	})
	assert.NoError(t, err)

	// Verify all 5 reports were created
	for _, p := range []string{sarifPath, jsonPath, htmlPath, junitPath, mdPath} {
		data, err := os.ReadFile(p)
		require.NoError(t, err, "report file %s must exist", p)
		assert.NotEmpty(t, data, "report file %s must not be empty", p)
	}
}


