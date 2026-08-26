// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { AdminLogsTab } from './AdminLogsTab.js';

describe('AdminLogsTab Component', () => {
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn().mockImplementation(async (url: string) => {
            if (url.includes('/api/admin/logs')) {
                return {
                    ok: true,
                    json: async () => [
                        { timestamp: '2026-08-20T10:00:00Z', level: 'info', module: 'auth', msg: 'User login success', payload: { uid: 123 } },
                        { timestamp: '2026-08-20T10:05:00Z', level: 'error', module: 'runner', msg: 'Runner crashed', error: 'Nil pointer' }
                    ]
                };
            }
            return { ok: true, json: async () => ({}) };
        });
        global.fetch = mockFetch;
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('requires admin secret authentication when none is set', async () => {
        render(<AdminLogsTab />);

        expect(screen.getByText(/Enter your Admin Secret key to authenticate/i)).toBeTruthy();
        
        const secretInput = screen.getByPlaceholderText('Enter Admin Secret');
        fireEvent.change(secretInput, { target: { value: 'super-admin-secret' } });

        const authBtn = screen.getByRole('button', { name: /Save & Authenticate/i });
        fireEvent.click(authBtn);

        await waitFor(() => {
            expect(screen.getByText('User login success')).toBeTruthy();
            expect(screen.getByText('Runner crashed')).toBeTruthy();
        });
    });

    it('filters logs by search query, module, and level when authenticated', async () => {
        localStorage.setItem('admin_secret', 'existing-secret');
        render(<AdminLogsTab />);

        await waitFor(() => {
            expect(screen.getByText('User login success')).toBeTruthy();
        });

        // Search message filter
        const searchInput = screen.getByPlaceholderText('Search messages...');
        fireEvent.change(searchInput, { target: { value: 'login' } });
        expect(screen.getByText('User login success')).toBeTruthy();
        expect(screen.queryByText('Runner crashed')).toBeNull();

        // Clear search
        fireEvent.change(searchInput, { target: { value: '' } });

        // Level filter
        const levelSelect = screen.getByRole('combobox');
        fireEvent.change(levelSelect, { target: { value: 'error' } });
        expect(screen.getByText('Runner crashed')).toBeTruthy();
        expect(screen.queryByText('User login success')).toBeNull();
    });

    it('allows inspecting payload details', async () => {
        localStorage.setItem('admin_secret', 'existing-secret');
        render(<AdminLogsTab />);

        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: 'Inspect' })[0]).toBeTruthy();
        });

        const inspectBtn = screen.getAllByRole('button', { name: 'Inspect' })[0];
        fireEvent.click(inspectBtn);

        expect(screen.getByText(/"uid": 123/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy();
    });

    it('clears admin secret and resets logs view', async () => {
        localStorage.setItem('admin_secret', 'existing-secret');
        render(<AdminLogsTab />);

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Clear Secret' })).toBeTruthy();
        });

        const clearBtn = screen.getByRole('button', { name: 'Clear Secret' });
        fireEvent.click(clearBtn);

        expect(screen.getByPlaceholderText('Enter Admin Secret')).toBeTruthy();
        expect(screen.queryByText('User login success')).toBeNull();
    });
});
