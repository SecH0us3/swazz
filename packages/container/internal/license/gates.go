// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package license

//go:generate go run ../../cmd/sync-features

// Feature identifiers used by the gate system. These are the canonical IDs
// embedded in signed license tokens (see scripts/issue-license.go).
const (
	FeatureHighConcurrency = "unlimited_scans"   // concurrency ceiling above the free default (5)
	FeatureScheduledRuns   = "scheduled_runs"    // scheduled / CI / recurring runs + webhooks
	FeatureReportExports   = "report_exports"   // SARIF / HTML / MD / JUnit exports (JSON stays free)
	FeatureAIRemediation   = "ai_remediation_pro" // AI-powered auto-remediation
	FeatureCloudHistory    = "cloud_history"     // dashboard compare / export, cloud-persisted history
	FeatureEnterprise      = "enterprise"        // SSO/RBAC, compliance PDF, Jira sync, SLA
)

// FeatureType describes how a feature is gated.
type FeatureType string

const (
	// FeatureTypePaid requires a valid license key with the feature granted.
	FeatureTypePaid FeatureType = "paid"
	// FeatureTypeComingSoon is visible in the UI for marketing but not yet
	// implemented — no server-side enforcement.
	FeatureTypeComingSoon FeatureType = "coming_soon"
)

// FeatureDef is the canonical, machine-readable feature manifest. It is the
// single source of truth for feature IDs, labels, and gate types; the
// TypeScript side is generated from it (see scripts/sync-features.go).
type FeatureDef struct {
	ID    string
	Label string
	Type  FeatureType
}

// Features is the canonical feature manifest. Keep it sorted by ID.
var Features = []FeatureDef{
	{ID: FeatureAIRemediation, Label: "AI Remediation Pro", Type: FeatureTypePaid},
	{ID: FeatureCloudHistory, Label: "Cloud History & Compare", Type: FeatureTypePaid},
	{ID: FeatureEnterprise, Label: "Enterprise (SSO / RBAC / Jira / SLA)", Type: FeatureTypePaid},
	{ID: FeatureHighConcurrency, Label: "High Concurrency", Type: FeatureTypePaid},
	{ID: FeatureReportExports, Label: "Report Exports (SARIF / HTML / MD / JUnit)", Type: FeatureTypePaid},
	{ID: FeatureScheduledRuns, Label: "Scheduled / CI Runs & Webhooks", Type: FeatureTypePaid},
	{ID: "waf_analysis", Label: "WAF Analysis", Type: FeatureTypeComingSoon},
	{ID: "domain_recon", Label: "Domain Reconnaissance", Type: FeatureTypeComingSoon},
}

// FreeConcurrencyCeiling is the community-mode concurrency cap. Never lower it:
// a 1-worker free tier breaks the 5-minute demo.
const FreeConcurrencyCeiling = 5

// MaxConcurrencyCeiling is the absolute cap enforced by the runner limiter.
const MaxConcurrencyCeiling = 1000

// Gate answers feature entitlement questions at clean enforcement seams.
// Implementations: LicenseGate (signed JWT), CommunityGate (no key), AllFeaturesGate (tests).
type Gate interface {
	Has(feature string) bool
	ConcurrencyCeiling() int
}

// LicenseGate wraps a verified *License.
type LicenseGate struct {
	lic *License
}

func NewLicenseGate(lic *License) *LicenseGate {
	return &LicenseGate{lic: lic}
}

func (g *LicenseGate) Has(feature string) bool {
	if g == nil || g.lic == nil {
		return false
	}
	return g.lic.HasFeature(feature)
}

func (g *LicenseGate) ConcurrencyCeiling() int {
	if g == nil || g.lic == nil {
		return FreeConcurrencyCeiling
	}
	if g.lic.MaxConcurrency > 0 {
		if g.lic.MaxConcurrency > MaxConcurrencyCeiling {
			return MaxConcurrencyCeiling
		}
		return g.lic.MaxConcurrency
	}
	// Feature granted without an explicit ceiling → unlock the absolute cap.
	if g.lic.HasFeature(FeatureHighConcurrency) {
		return MaxConcurrencyCeiling
	}
	return FreeConcurrencyCeiling
}

// CommunityGate is the default gate when no license key is present.
type CommunityGate struct{}

func NewCommunityGate() *CommunityGate { return &CommunityGate{} }

func (g *CommunityGate) Has(feature string) bool { return false }

func (g *CommunityGate) ConcurrencyCeiling() int { return FreeConcurrencyCeiling }

// AllFeaturesGate unlocks everything. Tests only — never use in production paths.
type AllFeaturesGate struct{}

func NewAllFeaturesGate() *AllFeaturesGate { return &AllFeaturesGate{} }

func (g *AllFeaturesGate) Has(feature string) bool { return true }

func (g *AllFeaturesGate) ConcurrencyCeiling() int { return MaxConcurrencyCeiling }

// GateFromLicense returns the appropriate gate for a loaded license:
// LicenseGate when a valid license is present, CommunityGate otherwise.
func GateFromLicense(lic *License) Gate {
	if lic == nil {
		return NewCommunityGate()
	}
	return NewLicenseGate(lic)
}
