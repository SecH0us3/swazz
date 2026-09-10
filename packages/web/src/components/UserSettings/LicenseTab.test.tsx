// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { LicenseTab } from './LicenseTab.js';
import { useAppStore } from '../../store/appStore.js';

describe('LicenseTab Component', () => {
    let storeMock: Record<string, string> = {};

    beforeEach(() => {
        vi.restoreAllMocks();
        storeMock = { swazz_token: 'mock-token' };
        const localStorageMock = {
            getItem: vi.fn((key: string) => storeMock[key] || null),
            setItem: vi.fn((key: string, value: string) => {
                storeMock[key] = value.toString();
            }),
            clear: vi.fn(() => {
                storeMock = {};
            }),
            removeItem: vi.fn((key: string) => {
                delete storeMock[key];
            }),
            length: 0,
            key: vi.fn(),
        };
        vi.stubGlobal('localStorage', localStorageMock);
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
        cleanup();
        vi.unstubAllGlobals();
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
                            kind: 'trial',
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
        expect(screen.getByText('Copy')).toBeTruthy();
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
                            kind: 'trial',
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
                            kind: 'trial',
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

    it('activates a custom license key and allows deactivating it via modal', async () => {
        const confirmSpy = vi.fn();
        vi.stubGlobal('confirm', confirmSpy);

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
                                kind: 'commercial',
                                max_users: 10,
                                max_concurrency: 50,
                                key_fingerprint: 'a1b2c3d4e5f6',
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

        // Deactivate via modal
        const deactivateBtn = screen.getByRole('button', { name: /Deactivate License/i });
        fireEvent.click(deactivateBtn);

        // Modal should appear
        expect(screen.getByText(/Deactivate the license for/i)).toBeTruthy();
        expect(confirmSpy).not.toHaveBeenCalled();

        const modalDeactivateBtn = screen.getAllByRole('button', { name: /^Deactivate$/i })[0];
        fireEvent.click(modalDeactivateBtn);

        await waitFor(() => {
            expect(screen.getByText('License deactivated.')).toBeTruthy();
        });
    });

    it('regression: user who previously claimed trial has commercial license active, not trial', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: true, claimed_at: '2026-08-01T00:00:00Z', can_claim: true }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'active',
                        license: {
                            company: 'Example Corp',
                            expires_at: '2027-04-09T00:00:00Z',
                            features: ['enterprise'],
                            kind: 'commercial',
                            max_users: 10,
                            max_concurrency: 100,
                            key_fingerprint: '1234567890abcdef',
                        },
                    }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText('Example Corp')).toBeTruthy();
        });

        // Should display Commercial or Enterprise, NOT Trial License Active
        expect(screen.getByText('Enterprise License Active')).toBeTruthy();
        expect(screen.queryByText('Trial License Active')).toBeNull();
        expect(screen.queryByRole('button', { name: /Renew 14-Day Trial/i })).toBeNull();
    });

    it('renders expired state with company and locked notice', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: true, claimed_at: '2026-01-01T00:00:00Z' }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'expired',
                        license: {
                            company: 'Expired Customer Ltd',
                            expires_at: '2026-05-01T00:00:00Z',
                            features: ['*'],
                            kind: 'commercial',
                            key_fingerprint: 'feedfacecafe0123',
                        },
                    }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText('License Expired')).toBeTruthy();
        });

        expect(screen.getByText('Expired Customer Ltd')).toBeTruthy();
        expect(screen.getByText(/Paid features are locked/i)).toBeTruthy();
        // Contact sales is available
        expect(screen.getByRole('button', { name: /✉ Contact Sales/i })).toBeTruthy();
    });

    it('does not trigger preview on typing, triggers on blur and paste for JWT keys', async () => {
        let verifyCallCount = 0;
        vi.spyOn(global, 'fetch').mockImplementation((url: any, options?: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: false }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 'community', license: null }),
                } as Response);
            }
            if (urlStr.includes('/api/license/verify') && options?.method === 'POST') {
                verifyCallCount++;
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        valid: true,
                        license: {
                            company: 'Preview Corp',
                            kind: 'commercial',
                            expires_at: '2027-01-01T00:00:00Z',
                            features: ['*'],
                        },
                    }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText('Commercial License Key')).toBeTruthy();
        });

        const textarea = screen.getByPlaceholderText(/Paste your SWAZZ_LICENSE_KEY here/i);

        // 1. Typing should NOT fire verification
        fireEvent.change(textarea, { target: { value: 'eyJhbGciOiJFZERTQSI.preview-payload.sig-bytes' } });
        expect(verifyCallCount).toBe(0);
        expect(screen.queryByText(/✓ Preview Corp/i)).toBeNull();

        // 2. Blur should trigger verification for valid JWT
        fireEvent.blur(textarea);
        await waitFor(() => {
            expect(screen.getByText(/✓ Preview Corp · commercial/i)).toBeTruthy();
        });
        expect(verifyCallCount).toBe(1);

        // 3. Non-JWT input on blur should NOT trigger verification
        fireEvent.change(textarea, { target: { value: 'not-a-jwt-string-at-all' } });
        expect(screen.queryByText(/✓ Preview Corp/i)).toBeNull();
        fireEvent.blur(textarea);
        expect(verifyCallCount).toBe(1); // unchanged
    });

    it('shows key preview on paste of a valid JWT key', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any, options?: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: false }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 'community', license: null }),
                } as Response);
            }
            if (urlStr.includes('/api/license/verify') && options?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        valid: true,
                        license: {
                            company: 'Pasted Corp',
                            kind: 'commercial',
                            expires_at: '2027-01-01T00:00:00Z',
                            features: ['*'],
                        },
                    }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText('Commercial License Key')).toBeTruthy();
        });

        const textarea = screen.getByPlaceholderText(/Paste your SWAZZ_LICENSE_KEY here/i);
        fireEvent.paste(textarea, {
            clipboardData: {
                getData: () => 'eyJhbGciOiJFZERTQSI.paste-payload.sig-bytes',
            },
        });

        await waitFor(() => {
            expect(screen.getByText(/✓ Pasted Corp · commercial/i)).toBeTruthy();
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

    it('associates Commercial License Key label with textarea via id and htmlFor', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: true, can_claim: false }),
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
            expect(screen.getByLabelText('Commercial License Key')).toBeTruthy();
        });
        const textarea = screen.getByLabelText('Commercial License Key');
        expect(textarea.getAttribute('id')).toBe('license-key-input');
    });

    it('does not show expiring soon hint for fresh 14-day trial, but shows for commercial <= 30 days', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: true, can_claim: false }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'active',
                        license: {
                            company: 'Tester (14-Day Trial)',
                            expires_at: new Date(Date.now() + 13 * 24 * 60 * 60 * 1000).toISOString(),
                            features: ['*'],
                            kind: 'trial',
                            max_users: 1,
                            max_concurrency: 1000,
                        },
                    }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        const { unmount } = render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText(/Trial License Active/i)).toBeTruthy();
        });

        // Fresh trial should NOT show expiring soon warning
        expect(screen.queryByText(/License expiring soon/i)).toBeNull();
        expect(screen.queryByText(/Trial expiring soon/i)).toBeNull();

        unmount();

        // Commercial license with 10 days remaining SHOULD show warning
        vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: true, can_claim: false }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'active',
                        license: {
                            company: 'Acme Corp',
                            expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
                            features: ['enterprise'],
                            kind: 'commercial',
                            max_users: 10,
                            max_concurrency: 50,
                        },
                    }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText(/Enterprise License Active/i)).toBeTruthy();
        });

        expect(screen.getByText(/License expiring soon \(10 days remaining\)/i)).toBeTruthy();
    });

    it('renders expired hint with .license-expired-hint class without inline color style', async () => {
        vi.spyOn(global, 'fetch').mockImplementation((url: any) => {
            const urlStr = String(url);
            if (urlStr.includes('/api/user/trial-status')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ claimed: true }),
                } as Response);
            }
            if (urlStr.includes('/api/user/license')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        status: 'expired',
                        license: {
                            company: 'Expired Customer Ltd',
                            expires_at: '2026-05-01T00:00:00Z',
                            features: ['*'],
                            kind: 'commercial',
                            key_fingerprint: 'feedfacecafe0123',
                        },
                    }),
                } as Response);
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        const { container } = render(<LicenseTab />);

        await waitFor(() => {
            expect(screen.getByText('License Expired')).toBeTruthy();
        });

        const expiredHint = container.querySelector('.license-expired-hint');
        expect(expiredHint).not.toBeNull();
        expect(expiredHint?.getAttribute('style')).toBeNull();
    });
});
