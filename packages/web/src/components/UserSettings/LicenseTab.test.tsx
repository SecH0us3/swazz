// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { LicenseTab } from './LicenseTab.js';
import { useAppStore } from '../../store/appStore.js';

describe('LicenseTab Component', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.setItem('swazz_token', 'mock-token');
        useAppStore.setState({
            userProfile: {
                username: 'tester',
                apiKey: 'swazz_live_testkey',
                isGuest: false,
            },
            csrfToken: 'mock-csrf',
            licenseStatus: null,
        });
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('renders unclaimed trial state and allows claiming 14-day trial', async () => {
        // Mock GET /api/user/license and GET /api/user/trial-status
        vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: false, claimed_at: null }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 'community', license: null }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText('Claim 14-Day Free Trial')).toBeTruthy();
        });

        expect(screen.getByText('14-Day Free Trial')).toBeTruthy();
        expect(screen.getByText(/Evaluate full enterprise capabilities/i)).toBeTruthy();

        // Now mock POST /api/user/trial-license
        vi.spyOn(global, 'fetch').mockImplementation((url: any, options: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-license') && options?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'ok',
                        license: {
                            company: 'tester (14-Day Trial)',
                            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                            features: ['*'],
                            max_users: 1,
                            max_concurrency: 1000,
                        },
                        token: 'eyJalg.eyPayload.sig123',
                    }),
                } as Response);
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({}),
            } as Response);
        });

        const claimBtn = screen.getByRole('button', { name: /Claim 14-Day Free Trial/i });
        fireEvent.click(claimBtn);

        await waitFor(() => {
            expect(screen.getByText(/14-day free trial license activated successfully/i)).toBeTruthy();
        });

        expect(screen.getByText(/Trial License Active/i)).toBeTruthy();
        expect(screen.getByText('tester (14-Day Trial)')).toBeTruthy();
        expect(screen.getByText('Copy Key')).toBeTruthy();
    });

    it('shows cooldown notice when trial was claimed recently and license is inactive', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        claimed: true,
                        claimed_at: '2026-09-03T10:00:00Z',
                        can_claim: false,
                        cooldown_remaining_ms: 14 * 60 * 60 * 1000,
                        next_available_at: '2026-09-04T10:00:00Z',
                    }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 'community', license: null }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText(/Next 14-day free trial will be available in 14 hours/i)).toBeTruthy();
        });

        expect(screen.queryByText('Claim 14-Day Free Trial')).toBeNull();
    });

    it('allows claiming trial again after 24-hour cooldown expires when license is inactive', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        claimed: true,
                        claimed_at: '2026-09-01T10:00:00Z',
                        can_claim: true,
                        cooldown_remaining_ms: 0,
                        next_available_at: null,
                    }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 'community', license: null }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Claim 14-Day Free Trial/i })).toBeTruthy();
        });
    });

    it('shows Renew 14-Day Trial button when active trial license is eligible for renewal', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any, options?: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        claimed: true,
                        claimed_at: '2026-09-01T10:00:00Z',
                        can_claim: true,
                        cooldown_remaining_ms: 0,
                        next_available_at: null,
                    }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'active',
                        license: {
                            company: 'tester (14-Day Trial)',
                            expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
                            features: ['*'],
                            max_users: 1,
                            max_concurrency: 1000,
                        },
                    }),
                } as Response);
            }
            if (urlStr.includes('/api/user/trial-license') && options?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'ok',
                        license: {
                            company: 'tester (14-Day Trial)',
                            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                            features: ['*'],
                            max_users: 1,
                            max_concurrency: 1000,
                        },
                        token: 'eyJrenewed.sig',
                    }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Renew 14-Day Trial/i })).toBeTruthy();
        });

        const renewBtn = screen.getByRole('button', { name: /Renew 14-Day Trial/i });
        fireEvent.click(renewBtn);

        await waitFor(() => {
            expect(screen.getByText(/14-day free trial license renewed successfully/i)).toBeTruthy();
        });
    });

    it('renders guest warning for guest users', () => {
        useAppStore.setState({
            userProfile: {
                username: 'guest_123',
                apiKey: 'guest_api_key',
                isGuest: true,
            },
        });

        render(<LicenseTab />);
        expect(screen.getByText(/License management is only available for registered users/i)).toBeTruthy();
    });

    it('activates a custom license key and allows deactivating it', async () => {
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });

        // 1. Initial GET status
        vi.spyOn(global, 'fetch').mockImplementation((url: any, options?: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: true, claimed_at: '2026-08-01T00:00:00Z' }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                if (options?.method === 'POST') {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({
                            license: {
                                company: 'Acme Corp',
                                expires_at: '2027-01-01T00:00:00Z',
                                features: ['enterprise', 'scheduled_runs'],
                                max_users: 10,
                                max_concurrency: 50,
                            }
                        })
                    } as Response);
                }
                if (options?.method === 'DELETE') {
                    return Promise.resolve({
                        ok: true,
                        json: () => Promise.resolve({ status: 'community' })
                    } as Response);
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 'community', license: null }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText('Commercial License Key')).toBeTruthy();
        });

        const input = screen.getByPlaceholderText(/Paste your SWAZZ_LICENSE_KEY here/i);
        fireEvent.change(input, { target: { value: 'SWAZZ_LICENSE_KEY: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig' } });

        const activateBtn = screen.getByRole('button', { name: 'Activate' });
        fireEvent.click(activateBtn);

        await waitFor(() => {
            expect(screen.getByText(/License activated for Acme Corp!/i)).toBeTruthy();
        });

        expect(screen.getByText('Acme Corp')).toBeTruthy();

        // Deactivate
        const deactivateBtn = screen.getByRole('button', { name: /Deactivate License/i });
        fireEvent.click(deactivateBtn);

        await waitFor(() => {
            expect(screen.getByText('License deactivated.')).toBeTruthy();
        });
    });

    it('handles activation failure error message', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any, options?: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: true, claimed_at: null }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                if (options?.method === 'POST') {
                    return Promise.resolve({
                        ok: false,
                        json: () => Promise.resolve({ error: 'Signature verification failed' })
                    } as Response);
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 'community', license: null }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText('Commercial License Key')).toBeTruthy();
        });

        const input = screen.getByPlaceholderText(/Paste your SWAZZ_LICENSE_KEY here/i);
        fireEvent.change(input, { target: { value: 'eyJ1.eyJ2.sig' } });
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        await waitFor(() => {
            expect(screen.getByText('Signature verification failed')).toBeTruthy();
        });
    });
});
