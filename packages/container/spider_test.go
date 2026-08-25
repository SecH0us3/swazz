// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"swazz-engine/internal/swagger"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSpiderCLI_FlagsAndConfigParsing(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "test_spider.config.json")

	configContent := `{
		// Base URL for the spider target
		"base_url": "http://example.com/api",
		"headers": {
			"Authorization": "Bearer token123"
		},
		"cookies": {
			"session": "abc456"
		},
		/* Auth sequence config */
		"auth_sequence": [
			{
				"type": "http",
				"method": "POST",
				"url": "http://example.com/api/login"
			}
		]
	}`
	err := os.WriteFile(configPath, []byte(configContent), 0644)
	require.NoError(t, err)

	// Verify loading config file logic as performed by runSpiderCLI
	configData, err := os.ReadFile(configPath)
	require.NoError(t, err)

	configData = swagger.StripJSONC(configData)

	var cliCfg CliConfig
	err = json.Unmarshal(configData, &cliCfg)
	require.NoError(t, err)

	assert.Equal(t, "http://example.com/api", cliCfg.BaseURL)
	assert.Equal(t, "Bearer token123", cliCfg.Headers["Authorization"])
	assert.Equal(t, "abc456", cliCfg.Cookies["session"])
	require.Len(t, cliCfg.AuthSequence, 1)
	assert.Equal(t, "http://example.com/api/login", cliCfg.AuthSequence[0].URL)
}

func TestRunSpiderCLIErr_ValidationAndErrors(t *testing.T) {
	// 1. Missing target URL and config
	err := runSpiderCLIErr([]string{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "usage:")

	// 2. Non-existent config file
	err = runSpiderCLIErr([]string{"-config", "nonexistent.json"})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to read config")

	// 3. Invalid JSON config
	tmpDir := t.TempDir()
	invalidCfg := filepath.Join(tmpDir, "invalid.json")
	require.NoError(t, os.WriteFile(invalidCfg, []byte(`{invalid`), 0600))
	err = runSpiderCLIErr([]string{"-config", invalidCfg})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid config JSON")

	// 4. Config without base_url and no URL arg
	emptyCfg := filepath.Join(tmpDir, "empty.json")
	require.NoError(t, os.WriteFile(emptyCfg, []byte(`{}`), 0600))
	err = runSpiderCLIErr([]string{"-config", emptyCfg})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no target URL specified")
}
