// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

import { getFeatureType, FEATURE_TYPE_PAID } from '@swazz/shared';

export interface LicenseInfo {
    company: string;
    expires_at: string;
    features: string[];
    max_users?: number;
    max_concurrency?: number;
}

export interface LicenseStatus {
    status: 'community' | 'active' | 'invalid';
    license: LicenseInfo | null;
}

export function hasFeature(licenseStatus: LicenseStatus | null, feature: string): boolean {
    if (licenseStatus?.status !== 'active' || !licenseStatus.license) return false;
    const lower = feature.toLowerCase();
    return licenseStatus.license.features.some(f => {
        const fl = f.toLowerCase();
        return fl === '*' || fl === 'all' || fl === lower;
    });
}

export function isComingSoon(feature: string): boolean {
    return getFeatureType(feature) !== FEATURE_TYPE_PAID;
}
