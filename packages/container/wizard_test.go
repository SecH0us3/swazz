// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"swazz-engine/internal/config"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"swazz-engine/internal/swagger"

	"github.com/manifoldco/promptui"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsPromptCanceled(t *testing.T) {
	assert.True(t, isPromptCanceled(promptui.ErrInterrupt))
	assert.True(t, isPromptCanceled(promptui.ErrEOF))
	assert.False(t, isPromptCanceled(errors.New("io error")))
	assert.False(t, isPromptCanceled(nil))
}

func TestSaveConfig(t *testing.T) {
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "swazz.config.json")

	cfg := &config.CliConfig{
		BaseURL: "http://example.com",
		Settings: swagger.Settings{
			Concurrency: 10,
			TimeoutMs:   5000,
		},
	}

	// 1. Success
	ok := saveConfig(configPath, cfg)
	assert.True(t, ok)

	data, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"base_url": "http://example.com"`)

	// 2. Invalid path
	okInvalid := saveConfig(filepath.Join(tmpDir, "nonexistent_dir", "sub", "config.json"), cfg)
	assert.False(t, okInvalid)
}

func TestValidatePositiveInt(t *testing.T) {
	assert.NoError(t, validatePositiveInt("10"))
	assert.NoError(t, validatePositiveInt(" 1 "))
	assert.Error(t, validatePositiveInt("0"))
	assert.Error(t, validatePositiveInt("-5"))
	assert.Error(t, validatePositiveInt("abc"))
	assert.Error(t, validatePositiveInt(""))
}

func TestValidateJSONBody(t *testing.T) {
	assert.NoError(t, validateJSONBody(""))
	assert.NoError(t, validateJSONBody("   "))
	assert.NoError(t, validateJSONBody(`{"key":"value"}`))
	assert.NoError(t, validateJSONBody(`[1, 2, 3]`))
	assert.Error(t, validateJSONBody(`{invalid-json`))
}

func TestValidateHeaderName(t *testing.T) {
	assert.NoError(t, validateHeaderName("Authorization"))
	assert.NoError(t, validateHeaderName("X-Custom-Header"))
	assert.Error(t, validateHeaderName(""))
	assert.Error(t, validateHeaderName("   "))
}

func TestValidateSwaggerURLInput(t *testing.T) {
	tmpDir := t.TempDir()
	localFile := filepath.Join(tmpDir, "swagger.json")
	require.NoError(t, os.WriteFile(localFile, []byte(`{}`), 0600))

	// Valid HTTP & HTTPS
	assert.NoError(t, validateSwaggerURLInput("https://example.com/openapi.json"))
	assert.NoError(t, validateSwaggerURLInput("http://example.com/swagger.json, https://api.com/spec"))

	// Valid Local File
	assert.NoError(t, validateSwaggerURLInput(localFile))

	// Invalid empty
	assert.Error(t, validateSwaggerURLInput(""))
	assert.Error(t, validateSwaggerURLInput("   "))

	// Inaccessible local file
	assert.Error(t, validateSwaggerURLInput(filepath.Join(tmpDir, "nonexistent_spec.json")))
}


