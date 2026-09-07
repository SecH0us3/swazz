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

// devPrivKeyPKCS8Hex is DEFAULT_DEV_LICENSE_PRIVKEY_HEX from
// packages/edge/src/services/license.ts: a PKCS#8-wrapped Ed25519 seed whose
// private half is committed to this repository, so anyone can sign a license
// with it. devPubKeyHex is its public half (DEFAULT_LICENSE_PUBKEY_HEX).
const (
	devPrivKeyPKCS8Hex = "302e020100300506032b657004220420b52bfb4e1736b2d3026e64fc4273b3703d1c3c993d6661a40b6f0c144678bef6"
	devPubKeyHex       = "0407b9eb6ca30fa7b7ef1f3b3b27d1aa6683b6c49cbb6b756561cfacc0597bef"
)

// devPrivateKey rebuilds the development signing key from the PKCS#8 seed.
func devPrivateKey(t *testing.T) ed25519.PrivateKey {
	t.Helper()
	der, err := hex.DecodeString(devPrivKeyPKCS8Hex)
	require.NoError(t, err)
	require.Len(t, der, 48)
	return ed25519.NewKeyFromSeed(der[len(der)-ed25519.SeedSize:])
}

func devSignedToken(t *testing.T) string {
	t.Helper()
	token, err := GenerateToken(devPrivateKey(t), &License{
		Company:   "Dev Key Forgery Inc",
		ExpiresAt: time.Now().Add(365 * 24 * time.Hour),
		Features:  []string{"*"},
	})
	require.NoError(t, err)
	return token
}

// The source tree must ship no trust anchor at all. Re-introducing the
// development key here would let anyone mint an Enterprise license that every
// released binary accepts.
func TestSourceDefaultPublicKeyIsUnset(t *testing.T) {
	assert.Empty(t, DefaultPublicKeyHex,
		"DefaultPublicKeyHex must stay empty in source; release builds inject the production key via -ldflags")
	assert.NotEqual(t, devPubKeyHex, DefaultPublicKeyHex,
		"the development public key must never be embedded: its private half is committed to this repository")
}

// A build with no embedded key and no SWAZZ_LICENSE_PUBKEY fails closed rather
// than trusting anything, which keeps the engine in community mode.
func TestNewVerifierWithoutAnyKeyFailsClosed(t *testing.T) {
	t.Setenv("SWAZZ_LICENSE_PUBKEY", "")
	restore := DefaultPublicKeyHex
	DefaultPublicKeyHex = ""
	defer func() { DefaultPublicKeyHex = restore }()

	verifier, err := NewVerifier("")
	require.Error(t, err)
	assert.Nil(t, verifier)
	assert.ErrorIs(t, err, ErrNoPublicKey)
}

// With SWAZZ_LICENSE_PUBKEY unset, verification uses exactly the key linked into
// the build (`-X swazz-engine/internal/license.DefaultPublicKeyHex=<hex>`).
func TestNewVerifierUsesBuildInjectedKey(t *testing.T) {
	t.Setenv("SWAZZ_LICENSE_PUBKEY", "")

	pubKey, privKey, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	restore := DefaultPublicKeyHex
	DefaultPublicKeyHex = hex.EncodeToString(pubKey) // simulates the release ldflags
	defer func() { DefaultPublicKeyHex = restore }()

	verifier, err := NewVerifier("")
	require.NoError(t, err)
	assert.Equal(t, ed25519.PublicKey(pubKey), verifier.PublicKey)

	lic := &License{
		Company:   "Acme Corp",
		ExpiresAt: time.Now().Add(24 * time.Hour),
		Features:  []string{"report_exports"},
	}
	token, err := GenerateToken(privKey, lic)
	require.NoError(t, err)

	verified, err := LoadAndVerify(token)
	require.NoError(t, err)
	assert.Equal(t, "Acme Corp", verified.Company)
	assert.True(t, verified.HasFeature("report_exports"))
}

// A release build carrying the production key must reject licenses minted with
// the public development private key.
func TestDevSignedTokenRejectedByProductionKey(t *testing.T) {
	t.Setenv("SWAZZ_LICENSE_PUBKEY", "")

	prodPubKey, _, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	restore := DefaultPublicKeyHex
	DefaultPublicKeyHex = hex.EncodeToString(prodPubKey)
	defer func() { DefaultPublicKeyHex = restore }()

	token := devSignedToken(t)

	lic, err := LoadAndVerify(token)
	assert.Nil(t, lic)
	assert.ErrorIs(t, err, ErrInvalidSignature)
}

// Developers opt into the dev key explicitly via SWAZZ_LICENSE_PUBKEY (what the
// local dev scripts export); nothing else trusts it.
func TestDevSignedTokenAcceptedOnlyWithExplicitDevPubkey(t *testing.T) {
	restore := DefaultPublicKeyHex
	DefaultPublicKeyHex = ""
	defer func() { DefaultPublicKeyHex = restore }()

	token := devSignedToken(t)

	t.Setenv("SWAZZ_LICENSE_PUBKEY", devPubKeyHex)
	lic, err := LoadAndVerify(token)
	require.NoError(t, err)
	assert.Equal(t, "Dev Key Forgery Inc", lic.Company)
}
