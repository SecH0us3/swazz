// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { TrafficCaptureTab } from './TrafficCaptureTab.js';
import { useAppStore } from '../../store/appStore.js';

describe('TrafficCaptureTab Component', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({})
        });
        localStorage.setItem('swazz_token', 'mock-traffic-token');
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined)
            }
        });
        useAppStore.setState({
            activeProject: {
                id: 'proj-traffic-123',
                name: 'Traffic Capture Proj',
                description: ''
            } as any,
            userProfile: {
                username: 'alice',
                apiKey: 'key',
                isGuest: false
            }
        });
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('renders project credentials and allows copying project ID and token', () => {
        render(<TrafficCaptureTab />);

        expect(screen.getByText('Browser Extension Sync')).toBeTruthy();
        expect(screen.getByText('proj-traffic-123')).toBeTruthy();

        const copyBtns = screen.getAllByRole('button', { name: 'Copy' });
        expect(copyBtns.length).toBeGreaterThanOrEqual(2);

        // Copy Project ID
        fireEvent.click(copyBtns[0]);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('proj-traffic-123');

        // Copy Token
        fireEvent.click(copyBtns[1]);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('mock-traffic-token');
    });

    it('dispatches swazz-handshake custom event on Auto-Sync button click', () => {
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

        render(<TrafficCaptureTab />);

        const syncBtn = screen.getByRole('button', { name: /Auto-Sync with Extension/i });
        fireEvent.click(syncBtn);

        expect(dispatchSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'swazz-handshake'
            })
        );
    });
});
