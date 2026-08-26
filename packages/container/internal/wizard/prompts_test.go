// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package wizard

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	swzconfig "swazz-engine/internal/config"

	"github.com/manifoldco/promptui"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidatePositiveInt(t *testing.T) {
	assert.NoError(t, ValidatePositiveInt("10"))
	assert.NoError(t, ValidatePositiveInt("  1  "))
	assert.Error(t, ValidatePositiveInt("0"))
	assert.Error(t, ValidatePositiveInt("-5"))
	assert.Error(t, ValidatePositiveInt("abc"))
	assert.Error(t, ValidatePositiveInt(""))
}

func TestValidateJSONBody(t *testing.T) {
	assert.NoError(t, ValidateJSONBody(""))
	assert.NoError(t, ValidateJSONBody("  "))
	assert.NoError(t, ValidateJSONBody(`{"key": "value"}`))
	assert.NoError(t, ValidateJSONBody(`[1, 2, 3]`))
	assert.Error(t, ValidateJSONBody(`{invalid_json`))
}

func TestValidateHeaderName(t *testing.T) {
	assert.NoError(t, ValidateHeaderName("Authorization"))
	assert.NoError(t, ValidateHeaderName("X-Custom-Header"))
	assert.Error(t, ValidateHeaderName(""))
	assert.Error(t, ValidateHeaderName("   "))
}

func TestValidateSwaggerURLInput(t *testing.T) {
	// Valid HTTP URLs
	assert.NoError(t, ValidateSwaggerURLInput("https://example.com/swagger.json"))
	assert.NoError(t, ValidateSwaggerURLInput("http://localhost:8080/openapi.yaml, https://api.com/swagger.json"))

	// Empty
	assert.Error(t, ValidateSwaggerURLInput(""))
	assert.Error(t, ValidateSwaggerURLInput("   "))

	// Non-existent file
	assert.Error(t, ValidateSwaggerURLInput("/non/existent/file.json"))

	// Existing file
	tmpFile, err := os.CreateTemp("", "swagger-*.json")
	require.NoError(t, err)
	defer os.Remove(tmpFile.Name())
	assert.NoError(t, ValidateSwaggerURLInput(tmpFile.Name()))
}

func TestIsPromptCanceled(t *testing.T) {
	assert.True(t, IsPromptCanceled(promptui.ErrInterrupt))
	assert.True(t, IsPromptCanceled(promptui.ErrEOF))
	assert.False(t, IsPromptCanceled(errors.New("other error")))
	assert.False(t, IsPromptCanceled(nil))
}

func TestSaveConfig(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "test.config.json")

	cfg := &swzconfig.CliConfig{
		BaseURL: "https://api.test.com",
		Headers: map[string]string{
			"X-Test": "123",
		},
	}

	ok := SaveConfig(cfgPath, cfg)
	assert.True(t, ok)

	// Verify file exists and is valid JSON
	data, err := os.ReadFile(cfgPath)
	require.NoError(t, err)
	assert.Contains(t, string(data), "https://api.test.com")
	assert.Contains(t, string(data), "X-Test")
}
