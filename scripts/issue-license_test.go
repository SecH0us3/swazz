// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

package main

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func createTempEd25519KeyPEM(t *testing.T) (string, ed25519.PublicKey) {
	t.Helper()
	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)

	der, err := x509.MarshalPKCS8PrivateKey(privKey)
	require.NoError(t, err)

	block := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: der,
	}

	tmpFile := filepath.Join(t.TempDir(), "ed25519_test.pem")
	err = os.WriteFile(tmpFile, pem.EncodeToMemory(block), 0600)
	require.NoError(t, err)

	return tmpFile, pubKey
}

func TestLoadEd25519PrivateKey_Success(t *testing.T) {
	keyPath, expectedPubKey := createTempEd25519KeyPEM(t)

	privKey, pubKey, err := loadEd25519PrivateKey(keyPath)
	require.NoError(t, err)
	assert.NotNil(t, privKey)
	assert.Equal(t, expectedPubKey, pubKey)
}

func TestLoadEd25519PrivateKey_FileNotFound(t *testing.T) {
	_, _, err := loadEd25519PrivateKey("/non/existent/path/key.pem")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "reading key file")
}

func TestLoadEd25519PrivateKey_NoPEMBlock(t *testing.T) {
	tmpFile := filepath.Join(t.TempDir(), "invalid.pem")
	require.NoError(t, os.WriteFile(tmpFile, []byte("NOT A PEM FILE"), 0600))

	_, _, err := loadEd25519PrivateKey(tmpFile)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no PEM block found")
}

func TestLoadEd25519PrivateKey_InvalidPKCS8Data(t *testing.T) {
	block := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: []byte("INVALID_DER_BYTES"),
	}

	tmpFile := filepath.Join(t.TempDir(), "corrupt.pem")
	require.NoError(t, os.WriteFile(tmpFile, pem.EncodeToMemory(block), 0600))

	_, _, err := loadEd25519PrivateKey(tmpFile)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parsing PKCS#8 private key")
}

func TestLoadEd25519PrivateKey_NonEd25519Key(t *testing.T) {
	// Generate an ECDSA P-256 key instead of Ed25519
	ecdsaKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)

	der, err := x509.MarshalPKCS8PrivateKey(ecdsaKey)
	require.NoError(t, err)

	block := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: der,
	}

	tmpFile := filepath.Join(t.TempDir(), "ecdsa.pem")
	require.NoError(t, os.WriteFile(tmpFile, pem.EncodeToMemory(block), 0600))

	_, _, err = loadEd25519PrivateKey(tmpFile)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "key is not Ed25519")
}

func TestGenerateToken(t *testing.T) {
	_, privKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)

	lic := &License{
		Company:   "UnitTestCorp",
		ExpiresAt: time.Now().Add(24 * time.Hour).Truncate(time.Second),
		Features:  []string{"sso", "rbac"},
		MaxUsers:  10,
	}

	token, err := generateToken(privKey, lic)
	require.NoError(t, err)

	parts := strings.Split(token, ".")
	require.Len(t, parts, 3, "JWT token must have 3 parts: header.payload.signature")

	// Verify Header
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	require.NoError(t, err)
	var header map[string]string
	require.NoError(t, json.Unmarshal(headerBytes, &header))
	assert.Equal(t, "EdDSA", header["alg"])
	assert.Equal(t, "JWT", header["typ"])

	// Verify Payload
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	require.NoError(t, err)
	var parsedLic License
	require.NoError(t, json.Unmarshal(payloadBytes, &parsedLic))
	assert.Equal(t, "UnitTestCorp", parsedLic.Company)
	assert.Equal(t, []string{"sso", "rbac"}, parsedLic.Features)
	assert.Equal(t, 10, parsedLic.MaxUsers)

	// Verify Signature
	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[2])
	require.NoError(t, err)
	signedMessage := []byte(parts[0] + "." + parts[1])
	pubKey := privKey.Public().(ed25519.PublicKey)
	assert.True(t, ed25519.Verify(pubKey, signedMessage, sigBytes))
}

func TestParseFeatures(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected []string
	}{
		{
			name:     "Wildcard default",
			input:    "*",
			expected: []string{"*"},
		},
		{
			name:     "Empty string default",
			input:    "",
			expected: []string{"*"},
		},
		{
			name:     "Whitespace only",
			input:    "   ",
			expected: []string{"*"},
		},
		{
			name:     "Comma-separated list with whitespace",
			input:    " sso, rbac , ai_remediation_pro ",
			expected: []string{"sso", "rbac", "ai_remediation_pro"},
		},
		{
			name:     "Single feature",
			input:    "sso",
			expected: []string{"sso"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := parseFeatures(tt.input)
			assert.Equal(t, tt.expected, res)
		})
	}
}
