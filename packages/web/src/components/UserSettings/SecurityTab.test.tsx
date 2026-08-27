// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { SecurityTab } from './SecurityTab.js';
import { useAppStore } from '../../store/appStore.js';

describe('SecurityTab Component', () => {
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('/api/auth/passkeys')) {
                return {
                    ok: true,
                    json: async () => ({
                        credentials: [
                            { id: 'pk-1', name: 'MacBook TouchID', created_at: '2026-08-20 12:00:00' }
                        ]
                    })
                };
            }
            return { ok: true, json: async () => ({}) };
        });
        global.fetch = mockFetch;
        localStorage.clear();
        localStorage.setItem('swazz_token', 'fake-jwt-token');

        useAppStore.setState({
            userProfile: {
                username: 'alice_sec',
                apiKey: 'swazz_live_1234567890abcdef',
                twoFactorEnabled: false
            }
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders passkeys list and handles deletion', async () => {
        render(<SecurityTab />);

        await waitFor(() => {
            expect(screen.getByText(/MacBook TouchID/i)).toBeTruthy();
        });

        const deleteBtn = screen.getByRole('button', { name: 'Delete' });
        fireEvent.click(deleteBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/auth/passkeys/pk-1',
                expect.objectContaining({ method: 'DELETE' })
            );
        });
    });

    it('handles 2FA setup flow with TOTP code verification', async () => {
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes('/api/auth/passkeys')) {
                return { ok: true, json: async () => ({ credentials: [] }) };
            }
            if (url.includes('/api/auth/2fa/setup')) {
                return {
                    ok: true,
                    json: async () => ({
                        secret: 'JBSWY3DPEHPK3PXP',
                        otpauth_url: 'otpauth://totp/Swazz:alice?secret=JBSWY3DPEHPK3PXP'
                    })
                };
            }
            if (url.includes('/api/auth/2fa/verify')) {
                return { ok: true, json: async () => ({ success: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<SecurityTab />);

        const passwordInput = screen.getByLabelText(/Enter your password to verify your identity/i);
        fireEvent.change(passwordInput, { target: { value: 'secretPassword123' } });

        const setupBtn = screen.getByRole('button', { name: /Set Up 2FA/i });
        fireEvent.click(setupBtn);

        await waitFor(() => {
            expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
        });

        const codeInput = screen.getByLabelText(/Enter the 6-digit code/i);
        fireEvent.change(codeInput, { target: { value: '123456' } });

        const verifyBtn = await screen.findByRole('button', { name: /Verify & Enable/i });
        fireEvent.click(verifyBtn);

        await waitFor(() => {
            expect(screen.getByText(/Two-factor authentication enabled successfully!/i)).toBeTruthy();
        });
    });

    it('handles 2FA disabling flow', async () => {
        useAppStore.setState({
            userProfile: {
                username: 'alice_sec',
                apiKey: 'swazz_live_1234567890abcdef',
                twoFactorEnabled: true
            }
        });

        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes('/api/auth/passkeys')) {
                return { ok: true, json: async () => ({ credentials: [] }) };
            }
            if (url.includes('/api/auth/2fa/disable')) {
                return { ok: true, json: async () => ({ success: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<SecurityTab />);

        expect(screen.getByText('Enabled')).toBeTruthy();

        const passInput = screen.getByLabelText(/Enter your account password to confirm/i);
        fireEvent.change(passInput, { target: { value: 'secretPass123' } });

        const codeInput = screen.getByLabelText(/Enter 6-digit code from your app/i);
        fireEvent.change(codeInput, { target: { value: '654321' } });

        const disableBtn = screen.getByRole('button', { name: /Disable 2FA/i });
        fireEvent.click(disableBtn);

        await waitFor(() => {
            expect(screen.getByText(/Two-factor authentication disabled./i)).toBeTruthy();
        });
    });

    it('renders guest restriction message for guest users', () => {
        useAppStore.setState({
            userProfile: {
                username: 'guest_user',
                apiKey: '',
                isGuest: true
            }
        });

        render(<SecurityTab />);
        expect(screen.getByText(/Two-factor authentication is only available for registered users/i)).toBeTruthy();
    });
});
