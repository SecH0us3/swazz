// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { AccountTab } from './AccountTab.js';
import { useAppStore } from '../../store/appStore.js';

describe('AccountTab Component', () => {
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn().mockImplementation(async (url: string) => {
            return { ok: true, json: async () => ({}) };
        });
        global.fetch = mockFetch;
        localStorage.clear();
        localStorage.setItem('swazz_token', 'fake-jwt-token');

        useAppStore.setState({
            userProfile: {
                username: 'alice_sec',
                apiKey: 'swazz_live_1234567890abcdef',
                publicKey: 'abcdef1234567890',
                twoFactorEnabled: false
            }
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders username, account level, and theme selector', () => {
        render(<AccountTab />);

        expect(screen.getByText('Account Details')).toBeTruthy();
        expect(screen.getByDisplayValue('alice_sec')).toBeTruthy();
        expect(screen.getByText(/Registered User/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'System' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Dark' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Light' })).toBeTruthy();
    });

    it('switches theme and toggles tip notifications', () => {
        render(<AccountTab />);

        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        fireEvent.click(screen.getByRole('button', { name: 'Light' }));

        const tipsCheckbox = screen.getByRole('checkbox');
        fireEvent.click(tipsCheckbox);
        
        const resetTipsBtn = screen.getByRole('button', { name: /Reset dismissed tips/i });
        fireEvent.click(resetTipsBtn);
    });

    it('handles API key visibility and copying', () => {
        const writeTextMock = vi.fn();
        Object.assign(navigator, {
            clipboard: { writeText: writeTextMock }
        });

        render(<AccountTab />);

        const showBtn = screen.getByRole('button', { name: 'Show' });
        fireEvent.click(showBtn);
        expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy();

        const copyBtn = screen.getByRole('button', { name: 'Copy' });
        fireEvent.click(copyBtn);
        expect(writeTextMock).toHaveBeenCalledWith('swazz_live_1234567890abcdef');
    });

    it('handles API key regeneration flow', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ api_key: 'swazz_live_new_key_123456' })
        });

        render(<AccountTab />);

        const regenBtn = screen.getByRole('button', { name: /Regenerate API Key/i });
        fireEvent.click(regenBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/auth/regenerate-key'),
                expect.objectContaining({ method: 'POST' })
            );
            expect(screen.getByDisplayValue('swazz_live_new_key_123456')).toBeTruthy();
        });

        const dismissBtn = screen.getByRole('button', { name: 'Dismiss' });
        fireEvent.click(dismissBtn);
        expect(screen.queryByText(/Please copy your new API key now/i)).toBeNull();
    });

    it('renders guest mode appropriately', () => {
        useAppStore.setState({
            userProfile: {
                username: 'guest_user',
                apiKey: '',
                isGuest: true
            }
        });

        render(<AccountTab />);
        expect(screen.getByText(/Guest Mode/i)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Regenerate API Key/i })).toBeNull();
    });
});
