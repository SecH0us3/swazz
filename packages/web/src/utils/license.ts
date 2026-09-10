// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

import { getFeatureType, FEATURE_TYPE_PAID } from '@swazz/shared';

export type LicenseKind = 'trial' | 'commercial';

export interface LicenseInfo {
  company: string;
  expires_at: string;
  features: string[];
  kind?: LicenseKind;
  max_users?: number;
  max_concurrency?: number;
  key_fingerprint?: string;
}

export interface LicenseStatus {
  status: 'community' | 'active' | 'expired' | 'invalid';
  license: LicenseInfo | null;
}

export const FREE_CONCURRENCY_CEILING = 5;
export const MAX_CONCURRENCY_CEILING = 1000;

export function isTrialLicense(license: LicenseInfo | null | undefined): boolean {
  if (!license) return false;
  if (license.kind !== undefined) {
    return license.kind === 'trial';
  }
  return Boolean(
    license.company &&
      (license.company.endsWith('(14-Day Trial)') || license.company === 'Swazz Trial User')
  );
}

export function licenseTierLabel(license: LicenseInfo | null | undefined): string {
  if (isTrialLicense(license)) {
    return 'Trial License Active';
  }
  const features = license?.features || [];
  const hasEnterprise = features.some((f) => {
    const fl = f.toLowerCase();
    return fl === '*' || fl === 'all' || fl === 'enterprise';
  });
  if (hasEnterprise) {
    return 'Enterprise License Active';
  }
  return 'Commercial License Active';
}

export function daysBadgeTone(remainingDays: number): 'ok' | 'warn' | 'danger' {
  if (remainingDays > 30) return 'ok';
  if (remainingDays >= 8) return 'warn';
  return 'danger';
}

export function formatLicenseDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function formatLicenseDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function hasFeature(licenseStatus: LicenseStatus | null, feature: string): boolean {
  if (licenseStatus?.status !== 'active' || !licenseStatus.license) return false;
  const lower = feature.toLowerCase();
  return licenseStatus.license.features.some((f) => {
    const fl = f.toLowerCase();
    return fl === '*' || fl === 'all' || fl === lower;
  });
}

export function isComingSoon(feature: string): boolean {
  return getFeatureType(feature) !== FEATURE_TYPE_PAID;
}
