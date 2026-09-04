// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LockedFeature } from './LockedFeature.js';
import { useAppStore } from '../../store/appStore.js';
import { FEATURE_SCHEDULED_RUNS, FEATURE_DOMAIN_RECON } from '@swazz/shared';
import { useToast } from '../../hooks/useToast.js';

vi.mock('../../hooks/useToast.js', () => ({
    useToast: vi.fn(() => ({ showToast: vi.fn() })),
}));

describe('LockedFeature', () => {
    beforeEach(() => {
        useAppStore.setState({ licenseStatus: null });
    });

    it('renders children with a lock badge when locked (paid)', () => {
        render(
            <LockedFeature feature={FEATURE_SCHEDULED_RUNS}>
                <span>Webhooks</span>
            </LockedFeature>
        );
        expect(screen.getByText('Webhooks')).toBeTruthy();
        expect(screen.getByText('🔒')).toBeTruthy();
    });

    it('renders children with a coming-soon badge for coming_soon features', () => {
        render(
            <LockedFeature feature={FEATURE_DOMAIN_RECON}>
                <span>Domain Recon</span>
            </LockedFeature>
        );
        expect(screen.getByText('Domain Recon')).toBeTruthy();
        expect(screen.getByText('⏳')).toBeTruthy();
    });

    it('renders children without a badge when unlocked', () => {
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
        render(
            <LockedFeature feature={FEATURE_SCHEDULED_RUNS}>
                <span>Webhooks</span>
            </LockedFeature>
        );
        expect(screen.getByText('Webhooks')).toBeTruthy();
        expect(screen.queryByText('🔒')).toBeNull();
    });

    it('shows a toast on click when locked', () => {
        const showToast = vi.fn();
        vi.mocked(useToast).mockReturnValue({ showToast, toasts: [], dismissToast: vi.fn() });

        render(
            <LockedFeature feature={FEATURE_SCHEDULED_RUNS}>
                <span>Webhooks</span>
            </LockedFeature>
        );
        fireEvent.click(screen.getByText('Webhooks'));
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('requires a paid plan'), 'error');
    });
});
