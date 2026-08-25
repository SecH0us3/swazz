// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"crypto/ed25519"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"swazz-engine/internal/license"
)

func TestValidatePprofAddr(t *testing.T) {
	// 1. Empty
	addr, err := validatePprofAddr("")
	assert.NoError(t, err)
	assert.Equal(t, "", addr)

	// 2. Localhost
	addr, err = validatePprofAddr("localhost:6060")
	assert.NoError(t, err)
	assert.Equal(t, "localhost:6060", addr)

	// 3. Loopback IP
	addr, err = validatePprofAddr("127.0.0.1:6060")
	assert.NoError(t, err)
	assert.Equal(t, "127.0.0.1:6060", addr)

	addr, err = validatePprofAddr("[::1]:6060")
	assert.NoError(t, err)
	assert.Equal(t, "[::1]:6060", addr)

	// 4. Non-loopback IP (unsafe error)
	_, err = validatePprofAddr("8.8.8.8:6060")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsafe")

	// 5. Invalid format
	_, err = validatePprofAddr("invalid host name with spaces")
	assert.Error(t, err)
}

func TestParsePprofAddr(t *testing.T) {
	// 1. Flag with space
	addr, remaining, err := parsePprofAddr([]string{"--pprof-addr", "127.0.0.1:6060", "start"}, func(string) string { return "" })
	require.NoError(t, err)
	assert.Equal(t, "127.0.0.1:6060", addr)
	assert.Equal(t, []string{"start"}, remaining)

	// 2. Flag with equals
	addr, remaining, err = parsePprofAddr([]string{"--pprof-addr=127.0.0.1:6060", "start"}, func(string) string { return "" })
	require.NoError(t, err)
	assert.Equal(t, "127.0.0.1:6060", addr)
	assert.Equal(t, []string{"start"}, remaining)

	// 3. Env var fallback
	addr, remaining, err = parsePprofAddr([]string{"start"}, func(k string) string {
		if k == "SWAZZ_PPROF_ADDR" {
			return "localhost:6060"
		}
		return ""
	})
	require.NoError(t, err)
	assert.Equal(t, "localhost:6060", addr)
	assert.Equal(t, []string{"start"}, remaining)

	// 4. Missing value for flag
	_, _, err = parsePprofAddr([]string{"--pprof-addr"}, func(string) string { return "" })
	assert.Error(t, err)
}

func TestPrintBSLBannerAndHelp(t *testing.T) {
	// Simple invocation to ensure no panic
	printBSLBanner()
	printHelp()
}

func TestRunLicenseCommand_AllStates(t *testing.T) {
	// 1. Community mode (empty key)
	t.Setenv("SWAZZ_LICENSE_KEY", "")
	runLicenseCommand()

	// 2. Invalid key
	t.Setenv("SWAZZ_LICENSE_KEY", "invalid-token-string")
	runLicenseCommand()

	// 3. Valid Enterprise token
	pubKey, privKey, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)
	pubKeyHex := hex.EncodeToString(pubKey)
	origKey := license.DefaultPublicKeyHex
	license.DefaultPublicKeyHex = pubKeyHex
	defer func() { license.DefaultPublicKeyHex = origKey }()

	licPayload := &license.License{
		Company:        "Acme Corp",
		ExpiresAt:      time.Now().Add(48 * time.Hour),
		Features:       []string{license.FeatureReportExports, "unlimited_scans"},
		MaxUsers:       10,
		MaxConcurrency: 20,
	}
	token, err := license.GenerateToken(privKey, licPayload)
	require.NoError(t, err)

	t.Setenv("SWAZZ_LICENSE_KEY", token)
	runLicenseCommand()
}

func TestRunGenerateKeys_FileCreation(t *testing.T) {
	tmpDir := t.TempDir()
	origWd, err := os.Getwd()
	require.NoError(t, err)
	require.NoError(t, os.Chdir(tmpDir))
	defer func() { _ = os.Chdir(origWd) }()

	runGenerateKeys()

	keyData, err := os.ReadFile(filepath.Join(tmpDir, "swazz_runner.key"))
	require.NoError(t, err)
	assert.NotEmpty(t, keyData)

	pubData, err := os.ReadFile(filepath.Join(tmpDir, "swazz_runner.pub"))
	require.NoError(t, err)
	assert.NotEmpty(t, pubData)
}
