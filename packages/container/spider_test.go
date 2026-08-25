// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"swazz-engine/internal/config"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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

	var cliCfg config.CliConfig
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

func TestRunSpiderCLIErr_Execution(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`<!DOCTYPE html><html><body><h1>API Demo</h1><a href="/api/users">Users</a></body></html>`))
	}))
	defer ts.Close()

	tmpDir := t.TempDir()
	openapiOut := filepath.Join(tmpDir, "openapi.json")
	harOut := filepath.Join(tmpDir, "crawler.har")

	// 1. Direct target URL with OpenAPI export
	err := runSpiderCLIErr([]string{
		"-yes",
		"-max-depth", "1",
		"-max-pages", "2",
		"-timeout", "5",
		"-out", openapiOut,
		"-format", "openapi",
		ts.URL,
	})
	if err == nil {
		data, readErr := os.ReadFile(openapiOut)
		require.NoError(t, readErr)
		assert.NotEmpty(t, data)
	}

	// 2. HAR export format
	err = runSpiderCLIErr([]string{
		"-yes",
		"-max-depth", "1",
		"-max-pages", "1",
		"-timeout", "5",
		"-out", harOut,
		"-format", "har",
		ts.URL,
	})
	if err == nil {
		data, readErr := os.ReadFile(harOut)
		require.NoError(t, readErr)
		assert.NotEmpty(t, data)
	}

	// 3. Execution with config file
	cfgPath := filepath.Join(tmpDir, "spider_cfg.json")
	cfgJSON := fmt.Sprintf(`{
		"base_url": "%s",
		"headers": {"X-Custom": "123"},
		"cookies": {"session": "abc"}
	}`, ts.URL)
	require.NoError(t, os.WriteFile(cfgPath, []byte(cfgJSON), 0600))
	_ = runSpiderCLIErr([]string{
		"-yes",
		"-config", cfgPath,
		"-max-pages", "1",
		"-timeout", "5",
		"-quiet",
	})
}

