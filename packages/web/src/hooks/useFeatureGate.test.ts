// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFeatureGate } from './useFeatureGate.js';
import { useAppStore } from '../store/appStore.js';
import { FEATURE_SCHEDULED_RUNS, FEATURE_DOMAIN_RECON } from '@swazz/shared';

describe('useFeatureGate', () => {
    beforeEach(() => {
        useAppStore.setState({ licenseStatus: null });
    });

    it('locks paid features in community mode', () => {
        const { result } = renderHook(() => useFeatureGate(FEATURE_SCHEDULED_RUNS));
        expect(result.current.unlocked).toBe(false);
        expect(result.current.gateType).toBe('paid');
        expect(result.current.lockMessage).toContain('requires a paid plan');
    });

    it('unlocks paid features with an active license', () => {
        useAppStore.setState({
            licenseStatus: {
                status: 'active',
                license: {
                    company: 'Acme',
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                    features: [FEATURE_SCHEDULED_RUNS],
                },
            },
        });
        const { result } = renderHook(() => useFeatureGate(FEATURE_SCHEDULED_RUNS));
        expect(result.current.unlocked).toBe(true);
    });

    it('unlocks paid features with a wildcard license', () => {
        useAppStore.setState({
            licenseStatus: {
                status: 'active',
                license: {
                    company: 'Acme',
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                    features: ['*'],
                },
            },
        });
        const { result } = renderHook(() => useFeatureGate(FEATURE_SCHEDULED_RUNS));
        expect(result.current.unlocked).toBe(true);
    });

    it('keeps paid features locked when the license lacks the feature', () => {
        useAppStore.setState({
            licenseStatus: {
                status: 'active',
                license: {
                    company: 'Acme',
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                    features: ['report_exports'],
                },
            },
        });
        const { result } = renderHook(() => useFeatureGate(FEATURE_SCHEDULED_RUNS));
        expect(result.current.unlocked).toBe(false);
    });

    it('locks paid features for an invalid license', () => {
        useAppStore.setState({ licenseStatus: { status: 'invalid', license: null } });
        const { result } = renderHook(() => useFeatureGate(FEATURE_SCHEDULED_RUNS));
        expect(result.current.unlocked).toBe(false);
    });

    it('marks coming_soon features as locked with a coming-soon message', () => {
        const { result } = renderHook(() => useFeatureGate(FEATURE_DOMAIN_RECON));
        expect(result.current.unlocked).toBe(false);
        expect(result.current.gateType).toBe('coming_soon');
        expect(result.current.lockMessage).toContain('coming soon');
    });

    it('reacts to license activation', () => {
        const { result } = renderHook(() => useFeatureGate(FEATURE_SCHEDULED_RUNS));
        expect(result.current.unlocked).toBe(false);

        act(() => {
            useAppStore.setState({
                licenseStatus: {
                    status: 'active',
                    license: {
                        company: 'Acme',
                        expires_at: new Date(Date.now() + 86400000).toISOString(),
                        features: [FEATURE_SCHEDULED_RUNS],
                    },
                },
            });
        });

        expect(result.current.unlocked).toBe(true);
    });
});
