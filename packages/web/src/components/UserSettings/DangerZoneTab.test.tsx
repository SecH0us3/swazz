// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { DangerZoneTab } from './DangerZoneTab.js';
import { useAppStore } from '../../store/appStore.js';

describe('DangerZoneTab Component', () => {
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('/api/users/me')) {
                return { ok: true, json: async () => ({ success: true }) };
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

    it('renders danger zone and handles two-step deletion confirmation', async () => {
        render(<DangerZoneTab />);

        expect(screen.getByText('Danger Zone')).toBeTruthy();

        const deleteBtn = screen.getByRole('button', { name: /Delete My Account & Data/i });
        fireEvent.click(deleteBtn);

        expect(screen.getByText(/⚠️ Irreversible Action!/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Yes, delete permanently/i })).toBeTruthy();

        const confirmBtn = screen.getByRole('button', { name: /Yes, delete permanently/i });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/users/me'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });
    });

    it('allows canceling account deletion warning', () => {
        render(<DangerZoneTab />);

        const deleteBtn = screen.getByRole('button', { name: /Delete My Account & Data/i });
        fireEvent.click(deleteBtn);

        const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
        fireEvent.click(cancelBtn);

        expect(screen.getByRole('button', { name: /Delete My Account & Data/i })).toBeTruthy();
        expect(screen.queryByText(/⚠️ Irreversible Action!/i)).toBeNull();
    });
});
