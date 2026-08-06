// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package license

import (
	"crypto/ed25519"
	"encoding/hex"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadAndVerify(t *testing.T) {
	t.Run("Returns (nil, nil) when key is empty and SWAZZ_LICENSE_KEY is unset", func(t *testing.T) {
		t.Setenv("SWAZZ_LICENSE_KEY", "")

		lic, err := LoadAndVerify("")
		require.NoError(t, err)
		assert.Nil(t, lic)
	})

	t.Run("Verifies valid Ed25519 token passed directly when DefaultPublicKeyHex matches test key", func(t *testing.T) {
		pubKey, privKey, err := ed25519.GenerateKey(nil)
		require.NoError(t, err)

		pubKeyHex := hex.EncodeToString(pubKey)
		origKey := DefaultPublicKeyHex
		DefaultPublicKeyHex = pubKeyHex
		defer func() { DefaultPublicKeyHex = origKey }()

		t.Setenv("SWAZZ_LICENSE_KEY", "")

		licPayload := &License{
			Company:   "TestCorp",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{"sso"},
		}

		token, err := GenerateToken(privKey, licPayload)
		require.NoError(t, err)

		lic, err := LoadAndVerify(token)
		require.NoError(t, err)
		require.NotNil(t, lic)
		assert.Equal(t, "TestCorp", lic.Company)
		assert.True(t, lic.HasFeature("sso"))
	})

	t.Run("Falls back to SWAZZ_LICENSE_KEY env var when argument is empty", func(t *testing.T) {
		pubKey, privKey, err := ed25519.GenerateKey(nil)
		require.NoError(t, err)

		pubKeyHex := hex.EncodeToString(pubKey)
		origKey := DefaultPublicKeyHex
		DefaultPublicKeyHex = pubKeyHex
		defer func() { DefaultPublicKeyHex = origKey }()

		licPayload := &License{
			Company:   "EnvCorp",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{"rbac"},
		}

		token, err := GenerateToken(privKey, licPayload)
		require.NoError(t, err)

		t.Setenv("SWAZZ_LICENSE_KEY", token)

		lic, err := LoadAndVerify("")
		require.NoError(t, err)
		require.NotNil(t, lic)
		assert.Equal(t, "EnvCorp", lic.Company)
		assert.True(t, lic.HasFeature("rbac"))
	})

	t.Run("Returns an error for invalid token strings", func(t *testing.T) {
		t.Setenv("SWAZZ_LICENSE_KEY", "")

		lic, err := LoadAndVerify("invalid.token.string")
		assert.Error(t, err)
		assert.Nil(t, lic)
	})
}
