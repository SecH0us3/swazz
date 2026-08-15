// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package remediation

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"swazz-engine/internal/license"
)

func TestGitPatcher_Gate(t *testing.T) {
	t.Run("community mode denies AI remediation", func(t *testing.T) {
		p := NewGitPatcher()
		_, err := p.CreateFixPR("/tmp/nonexistent", "f-1", "patch", "title", "body")
		require.Error(t, err)
		assert.Contains(t, err.Error(), license.FeatureAIRemediation)
	})

	t.Run("license without feature denies AI remediation", func(t *testing.T) {
		lic := &license.License{
			Company:   "NoRem",
			ExpiresAt: time.Now().Add(24 * time.Hour),
			Features:  []string{license.FeatureReportExports},
		}
		p := NewGitPatcher(license.NewLicenseGate(lic))
		_, err := p.CreateFixPR("/tmp/nonexistent", "f-1", "patch", "title", "body")
		require.Error(t, err)
		assert.Contains(t, err.Error(), license.FeatureAIRemediation)
	})

	t.Run("all-features gate proceeds past the gate", func(t *testing.T) {
		p := NewGitPatcher(license.NewAllFeaturesGate())
		_, err := p.CreateFixPR("/tmp/nonexistent", "f-1", "patch", "title", "body")
		require.Error(t, err)
		// Must fail on the repo path, not on the gate.
		assert.False(t, strings.Contains(err.Error(), license.FeatureAIRemediation))
	})
}
