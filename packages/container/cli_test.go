// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

