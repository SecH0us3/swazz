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

func TestConstName(t *testing.T) {
	assert.Equal(t, "FEATURE_AI_REMEDIATION_PRO", constName("ai_remediation_pro"))
	assert.Equal(t, "FEATURE_REPORT_EXPORTS", constName("report_exports"))
	assert.Equal(t, "FEATURE_CUSTOM_WORDLISTS", constName("custom_wordlists"))
	assert.Equal(t, "FEATURE_SINGLE", constName("single"))
}

func TestFindRepoRoot(t *testing.T) {
	root, err := findRepoRoot()
	require.NoError(t, err)
	assert.NotEmpty(t, root)

	pkgPath := filepath.Join(root, "package.json")
	data, err := os.ReadFile(pkgPath)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"workspaces"`)
}

func TestFindRepoRoot_Error(t *testing.T) {
	tmpDir := t.TempDir()
	origWd, err := os.Getwd()
	require.NoError(t, err)
	require.NoError(t, os.Chdir(tmpDir))
	defer func() { _ = os.Chdir(origWd) }()

	_, err = findRepoRoot()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "repo root not found")
}

func TestSyncFeaturesExecution(t *testing.T) {
	tmpDir := t.TempDir()
	// Create mock repo root with package.json
	pkgJSON := filepath.Join(tmpDir, "package.json")
	require.NoError(t, os.WriteFile(pkgJSON, []byte(`{"workspaces": ["packages/*"]}`), 0600))

	origWd, err := os.Getwd()
	require.NoError(t, err)
	require.NoError(t, os.Chdir(tmpDir))
	defer func() { _ = os.Chdir(origWd) }()

	// Calling main() in mock repo root generates features.ts
	main()

	outPath := filepath.Join(tmpDir, "packages", "shared", "src", "features.ts")
	data, err := os.ReadFile(outPath)
	require.NoError(t, err)
	assert.Contains(t, string(data), "FEATURE_REPORT_EXPORTS")
	assert.Contains(t, string(data), "export const FEATURES: FeatureDef[] = [")
}
