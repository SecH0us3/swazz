// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

// ⚠️ GENERATED FILE — DO NOT EDIT.
// Source of truth: packages/container/internal/license/gates.go (license.Features).
// Regenerate with: go run ./cmd/sync-features

export type FeatureType = 'paid' | 'coming_soon';

export interface FeatureDef {
  id: string;
  label: string;
  type: FeatureType;
}

export const FEATURE_TYPE_PAID: FeatureType = 'paid';
export const FEATURE_TYPE_COMING_SOON: FeatureType = 'coming_soon';

export const FEATURE_AI_REMEDIATION_PRO = 'ai_remediation_pro';
export const FEATURE_CLOUD_HISTORY = 'cloud_history';
export const FEATURE_DOMAIN_RECON = 'domain_recon';
export const FEATURE_ENTERPRISE = 'enterprise';
export const FEATURE_REPORT_EXPORTS = 'report_exports';
export const FEATURE_SCHEDULED_RUNS = 'scheduled_runs';
export const FEATURE_UNLIMITED_SCANS = 'unlimited_scans';
export const FEATURE_WAF_ANALYSIS = 'waf_analysis';

export const FEATURES: FeatureDef[] = [
  { id: FEATURE_AI_REMEDIATION_PRO, label: "AI Remediation Pro", type: "paid" },
  { id: FEATURE_CLOUD_HISTORY, label: "Cloud History & Compare", type: "paid" },
  { id: FEATURE_DOMAIN_RECON, label: "Domain Reconnaissance", type: "coming_soon" },
  { id: FEATURE_ENTERPRISE, label: "Enterprise (SSO / RBAC / Jira)", type: "paid" },
  { id: FEATURE_REPORT_EXPORTS, label: "Report Exports (SARIF / HTML / MD / JUnit)", type: "paid" },
  { id: FEATURE_SCHEDULED_RUNS, label: "Scheduled / CI Runs & Webhooks", type: "paid" },
  { id: FEATURE_UNLIMITED_SCANS, label: "High Concurrency", type: "paid" },
  { id: FEATURE_WAF_ANALYSIS, label: "WAF Analysis", type: "coming_soon" },
];

export function getFeature(id: string): FeatureDef | undefined {
  return FEATURES.find((f) => f.id === id);
}

export function getFeatureLabel(id: string): string {
  return getFeature(id)?.label ?? id;
}

export function getFeatureType(id: string): FeatureType {
  return getFeature(id)?.type ?? FEATURE_TYPE_PAID;
}
