// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

import { useAppStore } from '../store/appStore.js';
import { hasFeature, isComingSoon } from '../utils/license.js';
import { getFeatureLabel } from '@swazz/shared';

export interface FeatureGate {
    unlocked: boolean;
    gateType: 'paid' | 'coming_soon';
    label: string;
    lockMessage: string;
}

export function useFeatureGate(feature: string): FeatureGate {
    const licenseStatus = useAppStore(state => state.licenseStatus);
    const label = getFeatureLabel(feature);
    const comingSoon = isComingSoon(feature);

    if (comingSoon) {
        return {
            unlocked: false,
            gateType: 'coming_soon',
            label,
            lockMessage: `${label} is coming soon`,
        };
    }

    const unlocked = hasFeature(licenseStatus, feature);
    return {
        unlocked,
        gateType: 'paid',
        label,
        lockMessage: `${label} requires a paid plan`,
    };
}
