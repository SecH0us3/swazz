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

func TestLicenseVerification(t *testing.T) {
	pubKey, privKey, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	pubKeyHex := hex.EncodeToString(pubKey)
	verifier, err := NewVerifier(pubKeyHex)
	require.NoError(t, err)

	t.Run("Valid license with features", func(t *testing.T) {
		lic := &License{
			Company:   "Acme Corp",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{"sso", "rbac", "compliance_reports"},
			MaxUsers:  50,
		}

		token, err := GenerateToken(privKey, lic)
		require.NoError(t, err)
		assert.NotEmpty(t, token)

		verifiedLic, err := verifier.VerifyToken(token)
		require.NoError(t, err)
		assert.Equal(t, "Acme Corp", verifiedLic.Company)
		assert.True(t, verifiedLic.HasFeature("sso"))
		assert.True(t, verifiedLic.HasFeature("RBAC"))
		assert.False(t, verifiedLic.HasFeature("cloud_runners"))
	})

	t.Run("Expired license", func(t *testing.T) {
		lic := &License{
			Company:   "Expired Inc",
			ExpiresAt: time.Now().Add(-1 * time.Hour),
			Features:  []string{"sso"},
		}

		token, err := GenerateToken(privKey, lic)
		require.NoError(t, err)

		verifiedLic, err := verifier.VerifyToken(token)
		assert.ErrorIs(t, err, ErrLicenseExpired)
		assert.False(t, verifiedLic.HasFeature("sso"))
	})

	t.Run("Tampered token signature", func(t *testing.T) {
		lic := &License{
			Company:   "Tamper Ltd",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{"sso"},
		}

		token, err := GenerateToken(privKey, lic)
		require.NoError(t, err)

		tamperedToken := token + "tampered"
		_, err = verifier.VerifyToken(tamperedToken)
		assert.Error(t, err)
	})

	t.Run("Wildcard feature entitlement", func(t *testing.T) {
		lic := &License{
			Company:   "Enterprise Unlimited",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{"*"},
		}

		token, err := GenerateToken(privKey, lic)
		require.NoError(t, err)

		verifiedLic, err := verifier.VerifyToken(token)
		require.NoError(t, err)
		assert.True(t, verifiedLic.HasFeature("any_feature"))
	})
}
