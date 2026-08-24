// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { UserSettings } from './UserSettings.js';
import { useAppStore } from '../store/appStore.js';

describe('UserSettings Component', () => {
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('/api/auth/passkeys')) {
                return { ok: true, json: async () => ({ credentials: [] }) };
            }
            if (url.includes('/api/license')) {
                return { ok: true, json: async () => ({ tier: 'free', valid: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });
        global.fetch = mockFetch;
        localStorage.clear();
        localStorage.setItem('swazz_token', 'fake-jwt-token');

        // Set up store state
        useAppStore.setState({
            userProfile: {
                username: 'testdeveloper',
                apiKey: 'test-api-key-12345',
                publicKey: '9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a',
                twoFactorEnabled: false
            }
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders account details subtab by default and displays 3-way theme selector', () => {
        render(<UserSettings />);

        expect(screen.getByText('Settings')).toBeTruthy();
        expect(screen.getByDisplayValue('testdeveloper')).toBeTruthy();
        expect(screen.getByDisplayValue('test-api-key-12345')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'System' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Dark' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Light' })).toBeTruthy();
    });

    it('handles theme switching and tips toggles', () => {
        render(<UserSettings />);

        const darkBtn = screen.getByRole('button', { name: 'Dark' });
        fireEvent.click(darkBtn);

        const lightBtn = screen.getByRole('button', { name: 'Light' });
        fireEvent.click(lightBtn);

        const tipsCheckbox = screen.getByRole('checkbox');
        if (tipsCheckbox) {
            fireEvent.click(tipsCheckbox);
        }
    });

    it('handles API key regeneration flow', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ api_key: 'swazz_live_newly_generated_key_9999' })
        });

        render(<UserSettings />);

        const regenBtn = screen.getByRole('button', { name: /Regenerate API Key/i });
        fireEvent.click(regenBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/auth/regenerate-key'),
                expect.objectContaining({ method: 'POST' })
            );
            expect(screen.getByDisplayValue('swazz_live_newly_generated_key_9999')).toBeTruthy();
        });
    });

    it('can switch to Security subtab, start 2FA setup, and complete verification', async () => {
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes('/api/auth/passkeys')) {
                return { ok: true, json: async () => ({ credentials: [] }) };
            }
            if (url.includes('/api/auth/2fa/setup')) {
                return {
                    ok: true,
                    json: async () => ({
                        secret: 'JBSWY3DPEHPK3PXP',
                        otpauth_url: 'otpauth://totp/Swazz:testdeveloper?secret=JBSWY3DPEHPK3PXP&issuer=Swazz'
                    })
                };
            }
            if (url.includes('/api/auth/2fa/verify')) {
                return { ok: true, json: async () => ({ success: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<UserSettings />);

        // Switch to Security subtab
        const securityTabBtn = screen.getByRole('button', { name: /Security/i });
        fireEvent.click(securityTabBtn);

        expect(screen.getByText('Two-Factor Authentication (2FA)')).toBeTruthy();

        // Fill password and click Set Up 2FA
        const setupPasswordInput = screen.getByPlaceholderText('••••••••');
        fireEvent.change(setupPasswordInput, { target: { value: 'mypassword123' } });

        const setupBtn = screen.getByRole('button', { name: /Set Up 2FA/i });
        fireEvent.click(setupBtn);

        await waitFor(() => {
            expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
        });

        const codeInput = screen.getByPlaceholderText('000000');
        fireEvent.change(codeInput, { target: { value: '123456' } });

        const verifyBtn = screen.getByRole('button', { name: /Verify & Enable/i });
        fireEvent.click(verifyBtn);

        await waitFor(() => {
            expect(screen.getByText(/Two-factor authentication enabled successfully/i)).toBeTruthy();
        });
    });

    it('can switch to Security subtab and disable 2FA when already enabled', async () => {
        useAppStore.setState({
            userProfile: {
                username: 'testdeveloper',
                apiKey: 'test-api-key-12345',
                publicKey: '9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a',
                twoFactorEnabled: true
            }
        });

        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes('/api/auth/passkeys')) {
                return { ok: true, json: async () => ({ credentials: [] }) };
            }
            if (url.includes('/api/auth/2fa/disable')) {
                return { ok: true, json: async () => ({ success: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<UserSettings />);

        const securityTabBtn = screen.getByRole('button', { name: /Security/i });
        fireEvent.click(securityTabBtn);

        const passwordInput = screen.getByPlaceholderText('••••••••');
        fireEvent.change(passwordInput, { target: { value: 'mypassword123' } });

        const codeInput = screen.getByPlaceholderText('000000');
        fireEvent.change(codeInput, { target: { value: '654321' } });

        const disableBtn = screen.getByRole('button', { name: /Disable 2FA/i });
        fireEvent.click(disableBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/auth/2fa/disable'),
                expect.objectContaining({ method: 'POST' })
            );
        });
    });

    it('can switch to Danger Zone subtab and execute account deletion', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ message: 'Account deleted' })
        });

        render(<UserSettings />);

        // Switch to Danger Zone subtab
        const dangerTabBtn = screen.getByRole('button', { name: /Danger Zone/i });
        fireEvent.click(dangerTabBtn);

        expect(screen.getByText('Delete My Account & Data')).toBeTruthy();

        const deleteBtn = screen.getByRole('button', { name: 'Delete My Account & Data' });
        fireEvent.click(deleteBtn);

        expect(screen.getByText(/Irreversible Action/i)).toBeTruthy();

        const confirmDeleteBtn = screen.getByRole('button', { name: /Yes, delete permanently/i });
        fireEvent.click(confirmDeleteBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/users/me'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });
    });

    it('can switch to Admin subtab, enter secret, and render logs with search', async () => {
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes('/api/admin/logs')) {
                return {
                    ok: true,
                    json: async () => [
                        {
                            id: 'log-1',
                            timestamp: '2026-08-24T12:00:00Z',
                            level: 'error',
                            module: 'fuzzer',
                            msg: 'Fuzzing target timeout',
                            details: { target: 'http://example.com' }
                        },
                        {
                            id: 'log-2',
                            timestamp: '2026-08-24T12:01:00Z',
                            level: 'info',
                            module: 'auth',
                            msg: 'User logged in',
                            details: null
                        }
                    ]
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<UserSettings />);

        const adminTabBtn = screen.getByRole('button', { name: /Admin Logs/i });
        fireEvent.click(adminTabBtn);

        const secretInput = screen.getByPlaceholderText('Enter Admin Secret');
        fireEvent.change(secretInput, { target: { value: 'super-admin-secret' } });

        const saveBtn = screen.getByRole('button', { name: /Save & Authenticate/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(screen.getByText(/Fuzzing target timeout/i)).toBeTruthy();
            expect(screen.getByText(/User logged in/i)).toBeTruthy();
        });

        // Test search filtering
        const searchInput = screen.getByPlaceholderText(/Search messages/i);
        fireEvent.change(searchInput, { target: { value: 'timeout' } });
        expect(screen.getByText(/Fuzzing target timeout/i)).toBeTruthy();
        expect(screen.queryByText(/User logged in/i)).toBeNull();
    });

    it('can switch to MCP Integration subtab and show setups', () => {
        render(<UserSettings />);

        const mcpTabBtn = screen.getByRole('button', { name: /MCP Integration/i });
        fireEvent.click(mcpTabBtn);

        expect(screen.getByText('Model Context Protocol (MCP) Integration')).toBeTruthy();
        expect(screen.getByText(/Claude Desktop Setup/i)).toBeTruthy();
        expect(screen.getAllByText(/Google Antigravity/i).length).toBeGreaterThan(0);
    });

    it('can switch to Traffic Capture subtab and show extension sync options', () => {
        render(<UserSettings />);

        const trafficTabBtn = screen.getByRole('button', { name: /Traffic Capture/i });
        fireEvent.click(trafficTabBtn);

        expect(screen.getByText('Browser Extension Sync')).toBeTruthy();
        expect(screen.getByText(/Connect the Swazz Traffic Capturer/i)).toBeTruthy();
    });

    it('can switch to License subtab', () => {
        render(<UserSettings />);

        const licenseTabBtn = screen.getByRole('button', { name: /License & Subscription/i });
        fireEvent.click(licenseTabBtn);

        expect(screen.getByText(/License Status/i)).toBeTruthy();
    });
});
