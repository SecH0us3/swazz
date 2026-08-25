// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
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

	cfg := &CliConfig{
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
