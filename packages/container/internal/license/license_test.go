// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package license

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

	t.Run("Valid license with features and max users", func(t *testing.T) {
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
		assert.Equal(t, 50, verifiedLic.MaxUsers)
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

	t.Run("Verifier with base64 public key", func(t *testing.T) {
		pubKeyB64 := base64.RawURLEncoding.EncodeToString(pubKey)
		b64Verifier, err := NewVerifier(pubKeyB64)
		require.NoError(t, err)

		lic := &License{
			Company:   "Base64 Key Inc",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{"all"},
		}

		token, err := GenerateToken(privKey, lic)
		require.NoError(t, err)

		verifiedLic, err := b64Verifier.VerifyToken(token)
		require.NoError(t, err)
		assert.Equal(t, "Base64 Key Inc", verifiedLic.Company)
	})

	t.Run("Verifier with invalid public key length", func(t *testing.T) {
		_, err := NewVerifier("1234567890abcdef")
		assert.ErrorIs(t, err, ErrNoPublicKey)
	})
}

// createTempEd25519PEM helper creates a temporary PKCS#8 PEM encoded Ed25519 private key file.
func createTempEd25519PEM(t *testing.T) (string, ed25519.PublicKey) {
	pubKey, privKey, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	pkcs8Bytes, err := x509.MarshalPKCS8PrivateKey(privKey)
	require.NoError(t, err)

	pemBlock := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: pkcs8Bytes,
	}

	tmpFile, err := os.CreateTemp("", "swazz_test_key_*.pem")
	require.NoError(t, err)

	err = pem.Encode(tmpFile, pemBlock)
	require.NoError(t, err)
	tmpFile.Close()

	t.Cleanup(func() {
		os.Remove(tmpFile.Name())
	})

	return tmpFile.Name(), pubKey
}

func TestIssueLicenseCLI_E2E(t *testing.T) {
	pemPath, expectedPubKey := createTempEd25519PEM(t)
	expectedPubKeyHex := hex.EncodeToString(expectedPubKey)

	scriptPath, err := filepath.Abs("../../../../scripts/issue-license.go")
	require.NoError(t, err)
	require.FileExists(t, scriptPath)

	t.Run("Successful license issuance via CLI script", func(t *testing.T) {
		cmd := exec.Command("go", "run", scriptPath,
			"-key", pemPath,
			"-company", "CyberCorp International",
			"-days", "90",
			"-features", "sso,rbac,ai_remediation_pro",
			"-max-users", "25",
		)

		output, err := cmd.CombinedOutput()
		outStr := string(output)
		require.NoError(t, err, "CLI script execution failed: %s", outStr)

		assert.Contains(t, outStr, "🔑 SWAZZ ENTERPRISE LICENSE KEY GENERATED SUCCESSFULLY")
		assert.Contains(t, outStr, "Company:           CyberCorp International")
		assert.Contains(t, outStr, "Features:          sso, rbac, ai_remediation_pro")
		assert.Contains(t, outStr, "Max Users:         25")
		assert.Contains(t, outStr, expectedPubKeyHex)

		// Parse token from CLI output
		lines := strings.Split(outStr, "\n")
		var token string
		for i, line := range lines {
			if strings.TrimSpace(line) == "SWAZZ_LICENSE_KEY:" && i+1 < len(lines) {
				token = strings.TrimSpace(lines[i+1])
				break
			}
		}

		require.NotEmpty(t, token, "Failed to extract SWAZZ_LICENSE_KEY token from output: %s", outStr)

		// Verify token using license.Verifier
		verifier, err := NewVerifier(expectedPubKeyHex)
		require.NoError(t, err)

		lic, err := verifier.VerifyToken(token)
		require.NoError(t, err)
		assert.Equal(t, "CyberCorp International", lic.Company)
		assert.Equal(t, 25, lic.MaxUsers)
		assert.True(t, lic.HasFeature("sso"))
		assert.True(t, lic.HasFeature("RBAC"))
		assert.True(t, lic.HasFeature("ai_remediation_pro"))
		assert.False(t, lic.HasFeature("cloud_scanners"))
	})

	t.Run("CLI script missing required key flag", func(t *testing.T) {
		cmd := exec.Command("go", "run", scriptPath, "-company", "NoKeyCorp")
		output, err := cmd.CombinedOutput()
		assert.Error(t, err)
		assert.Contains(t, string(output), "Error: -key flag is required")
	})

	t.Run("CLI script missing required company flag", func(t *testing.T) {
		cmd := exec.Command("go", "run", scriptPath, "-key", pemPath)
		output, err := cmd.CombinedOutput()
		assert.Error(t, err)
		assert.Contains(t, string(output), "Error: -company flag is required")
	})
}
