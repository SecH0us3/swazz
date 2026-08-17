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

var allFeatures = []string{
	FeatureHighConcurrency,
	FeatureScheduledRuns,
	FeatureReportExports,
	FeatureAIRemediation,
	FeatureCloudHistory,
	FeatureEnterprise,
}

func TestCommunityGate(t *testing.T) {
	g := NewCommunityGate()

	for _, f := range allFeatures {
		assert.False(t, g.Has(f), "community gate must deny %q", f)
	}
	assert.Equal(t, FreeConcurrencyCeiling, g.ConcurrencyCeiling())
}

func TestAllFeaturesGate(t *testing.T) {
	g := NewAllFeaturesGate()

	for _, f := range allFeatures {
		assert.True(t, g.Has(f), "all-features gate must allow %q", f)
	}
	assert.Equal(t, MaxConcurrencyCeiling, g.ConcurrencyCeiling())
}

func TestLicenseGate(t *testing.T) {
	t.Run("denies everything when license is nil", func(t *testing.T) {
		g := NewLicenseGate(nil)
		assert.False(t, g.Has(FeatureReportExports))
		assert.Equal(t, FreeConcurrencyCeiling, g.ConcurrencyCeiling())
	})

	t.Run("grants only listed features", func(t *testing.T) {
		lic := &License{
			Company:   "Acme",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{FeatureReportExports, FeatureAIRemediation},
		}
		g := NewLicenseGate(lic)

		assert.True(t, g.Has(FeatureReportExports))
		assert.True(t, g.Has(FeatureAIRemediation))
		assert.False(t, g.Has(FeatureScheduledRuns))
		assert.False(t, g.Has(FeatureHighConcurrency))
		assert.False(t, g.Has(FeatureCloudHistory))
		assert.False(t, g.Has(FeatureEnterprise))
	})

	t.Run("wildcard grants everything", func(t *testing.T) {
		lic := &License{
			Company:   "Unlimited",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{"*"},
		}
		g := NewLicenseGate(lic)

		assert.True(t, g.Has(FeatureEnterprise))
		assert.True(t, g.Has(FeatureScheduledRuns))
	})

	t.Run("expired license denies features", func(t *testing.T) {
		lic := &License{
			Company:   "Expired",
			ExpiresAt: time.Now().Add(-1 * time.Hour),
			Features:  []string{"*"},
		}
		g := NewLicenseGate(lic)

		assert.False(t, g.Has(FeatureReportExports))
	})

	t.Run("concurrency ceiling from MaxConcurrency", func(t *testing.T) {
		lic := &License{
			Company:        "Scaled",
			ExpiresAt:      time.Now().Add(24 * time.Hour),
			Features:       []string{FeatureHighConcurrency},
			MaxConcurrency: 50,
		}
		g := NewLicenseGate(lic)

		assert.Equal(t, 50, g.ConcurrencyCeiling())
	})

	t.Run("concurrency ceiling falls back to absolute max when feature granted without value", func(t *testing.T) {
		lic := &License{
			Company:   "Default",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{FeatureHighConcurrency},
		}
		g := NewLicenseGate(lic)

		assert.Equal(t, MaxConcurrencyCeiling, g.ConcurrencyCeiling())
	})

	t.Run("concurrency ceiling stays at free default without the feature", func(t *testing.T) {
		lic := &License{
			Company:   "NoFeature",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{FeatureReportExports},
		}
		g := NewLicenseGate(lic)

		assert.Equal(t, FreeConcurrencyCeiling, g.ConcurrencyCeiling())
	})

	t.Run("concurrency ceiling clamps to absolute max", func(t *testing.T) {
		lic := &License{
			Company:        "Overkill",
			ExpiresAt:      time.Now().Add(24 * time.Hour),
			Features:       []string{FeatureHighConcurrency},
			MaxConcurrency: 5000,
		}
		g := NewLicenseGate(lic)

		assert.Equal(t, MaxConcurrencyCeiling, g.ConcurrencyCeiling())
	})
}

func TestGateFromLicense(t *testing.T) {
	t.Run("nil license returns community gate", func(t *testing.T) {
		g := GateFromLicense(nil)
		_, ok := g.(*CommunityGate)
		require.True(t, ok)
		assert.False(t, g.Has(FeatureReportExports))
	})

	t.Run("valid license returns license gate", func(t *testing.T) {
		lic := &License{
			Company:   "Corp",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{"*"},
		}
		g := GateFromLicense(lic)
		_, ok := g.(*LicenseGate)
		require.True(t, ok)
		assert.True(t, g.Has(FeatureEnterprise))
	})
}

func TestMaxConcurrencyRoundTrip(t *testing.T) {
	pubKey, privKey, err := ed25519.GenerateKey(nil)
	require.NoError(t, err)

	verifier, err := NewVerifier(hex.EncodeToString(pubKey))
	require.NoError(t, err)

	lic := &License{
		Company:        "RoundTrip",
		ExpiresAt:      time.Now().Add(24 * time.Hour),
		Features:       []string{FeatureHighConcurrency},
		MaxConcurrency: 75,
	}

	token, err := GenerateToken(privKey, lic)
	require.NoError(t, err)

	verified, err := verifier.VerifyToken(token)
	require.NoError(t, err)
	assert.Equal(t, 75, verified.MaxConcurrency)
	assert.True(t, verified.HasFeature(FeatureHighConcurrency))
}
