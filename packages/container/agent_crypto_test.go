// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAgentCrypto_LoadPrivateKey_HexSeed(t *testing.T) {
	seed := []byte("0123456789abcdef0123456789abcdef") // 32 bytes
	seedHex := hex.EncodeToString(seed)

	key, err := loadPrivateKey(seedHex)
	require.NoError(t, err)
	require.NotNil(t, key)
	assert.Equal(t, ed25519.PrivateKeySize, len(key))

	expectedKey := ed25519.NewKeyFromSeed(seed)
	assert.Equal(t, expectedKey, key)
}

func TestAgentCrypto_LoadPrivateKey_HexFullKey(t *testing.T) {
	_, priv, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	privHex := hex.EncodeToString(priv)
	key, err := loadPrivateKey(privHex)
	require.NoError(t, err)
	assert.Equal(t, priv, key)
}

func TestAgentCrypto_LoadPrivateKey_Base64(t *testing.T) {
	seed := []byte("fedcba9876543210fedcba9876543210") // 32 bytes

	// Standard Base64
	seedB64 := base64.StdEncoding.EncodeToString(seed)
	key1, err := loadPrivateKey(seedB64)
	require.NoError(t, err)
	assert.Equal(t, ed25519.NewKeyFromSeed(seed), key1)

	// Raw Base64 (unpadded)
	seedRawB64 := base64.RawStdEncoding.EncodeToString(seed)
	key2, err := loadPrivateKey(seedRawB64)
	require.NoError(t, err)
	assert.Equal(t, ed25519.NewKeyFromSeed(seed), key2)

	// Full 64-byte private key in Base64
	_, fullPriv, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	fullB64 := base64.StdEncoding.EncodeToString(fullPriv)
	key3, err := loadPrivateKey(fullB64)
	require.NoError(t, err)
	assert.Equal(t, fullPriv, key3)
}

func TestAgentCrypto_LoadPrivateKey_FromFile(t *testing.T) {
	tmpDir := t.TempDir()
	seed := []byte("0123456789abcdef0123456789abcdef")

	// Hex in file
	hexFile := filepath.Join(tmpDir, "key.hex")
	require.NoError(t, os.WriteFile(hexFile, []byte(hex.EncodeToString(seed)+"\n"), 0600))
	keyHex, err := loadPrivateKey(hexFile)
	require.NoError(t, err)
	assert.Equal(t, ed25519.NewKeyFromSeed(seed), keyHex)

	// Base64 in file
	b64File := filepath.Join(tmpDir, "key.b64")
	require.NoError(t, os.WriteFile(b64File, []byte(base64.StdEncoding.EncodeToString(seed)+"\r\n"), 0600))
	keyB64, err := loadPrivateKey(b64File)
	require.NoError(t, err)
	assert.Equal(t, ed25519.NewKeyFromSeed(seed), keyB64)

	// Read error when path is directory
	subDir := filepath.Join(tmpDir, "subdir")
	require.NoError(t, os.Mkdir(subDir, 0755))
	_, err = loadPrivateKey(subDir)
	assert.Error(t, err)
}

func TestAgentCrypto_LoadPrivateKey_InvalidInputs(t *testing.T) {
	// Invalid characters (not hex and not valid base64)
	_, err := loadPrivateKey("invalid!!hex??")
	assert.Error(t, err)

	// Invalid length (16 bytes hex)
	shortHex := hex.EncodeToString(make([]byte, 16))
	_, err = loadPrivateKey(shortHex)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid private key size")

	// Invalid length (48 bytes hex)
	midHex := hex.EncodeToString(make([]byte, 48))
	_, err = loadPrivateKey(midHex)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid private key size")

	// Invalid length (10 bytes base64)
	shortB64 := base64.StdEncoding.EncodeToString([]byte("0123456789"))
	_, err = loadPrivateKey(shortB64)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid private key size")
}

func TestAgentCrypto_SignChallenge(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	nonce := "challenge_nonce_xyz_12345"
	sigHex := signChallenge(priv, nonce)
	require.NotEmpty(t, sigHex)

	sigBytes, err := hex.DecodeString(sigHex)
	require.NoError(t, err)

	valid := ed25519.Verify(pub, []byte(nonce), sigBytes)
	assert.True(t, valid, "signature should verify with corresponding public key")
}
