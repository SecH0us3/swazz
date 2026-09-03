// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { AnomaliesTab } from './AnomaliesTab.js';

const mockUpdateConfig = vi.fn();
const mockUpdateSettings = vi.fn();
const mockShowToast = vi.fn();
let mockConfig: any = {};

vi.mock('../../hooks/useConfig.js', () => ({
    useConfig: () => ({
        config: mockConfig,
        updateConfig: mockUpdateConfig,
        updateSettings: mockUpdateSettings
    })
}));

vi.mock('../../hooks/useToast.js', () => ({
    useToast: () => ({
        showToast: mockShowToast
    })
}));

describe('AnomaliesTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('alert', vi.fn());
        mockConfig = {
            rules: {
                ignore: [404]
            },
            settings: {
                analyze_response_body: true,
                time_anomaly_threshold_ms: 4000,
                bola_testing: false
            },
            security: {
                allow_private_ips: false
            }
        };
    });

    it('renders with initial ignore codes', () => {
        render(<AnomaliesTab />);
        expect(screen.getByText('404')).toBeTruthy();
    });

    it('adds a valid ignore code', async () => {
        render(<AnomaliesTab />);
        const input = screen.getByPlaceholderText('e.g. 404');
        const addBtn = screen.getByText('Add Code');
        
        fireEvent.change(input, { target: { value: '500' } });
        fireEvent.click(addBtn);

        expect(mockUpdateConfig).toHaveBeenCalledWith({
            rules: {
                ignore: [404, 500]
            }
        });
    });

    it('shows error for invalid ignore code', async () => {
        render(<AnomaliesTab />);
        const input = screen.getByPlaceholderText('e.g. 404');
        const addBtn = screen.getByText('Add Code');
        
        fireEvent.change(input, { target: { value: '99' } });
        fireEvent.click(addBtn);
        
        expect(mockShowToast).toHaveBeenCalledWith('Please enter a valid 3-digit HTTP status code (100-599).', 'error');
        expect(mockUpdateConfig).not.toHaveBeenCalled();
    });
    
    it('removes an ignore code', async () => {
        render(<AnomaliesTab />);
        const removeBtns = screen.getAllByText('✕');
        fireEvent.click(removeBtns[0]);
        
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            rules: {
                ignore: []
            }
        });
    });

    it('ignores duplicate status code and rejects non-numeric/out-of-range code', () => {
        render(<AnomaliesTab />);
        const input = screen.getByPlaceholderText('e.g. 404');
        const addBtn = screen.getByText('Add Code');

        // Duplicate code 404
        fireEvent.change(input, { target: { value: '404' } });
        fireEvent.click(addBtn);
        expect(mockUpdateConfig).not.toHaveBeenCalled();

        // Out of range (e.g. 999)
        fireEvent.change(input, { target: { value: '999' } });
        fireEvent.click(addBtn);
        expect(mockShowToast).toHaveBeenCalledWith('Please enter a valid HTTP status code (100-599).', 'error');
    });

    it('updates timeout anomalies threshold', async () => {
        render(<AnomaliesTab />);
        const input = screen.getByDisplayValue('4000');
        fireEvent.change(input, { target: { value: '5000' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith({ time_anomaly_threshold_ms: 5000 });
    });

    it('toggles SSRF protection', async () => {
        render(<AnomaliesTab />);
        const ssrfCheckbox = screen.getByLabelText(/Allow Scanner Private IP Scopes/i);
        fireEvent.click(ssrfCheckbox);
        expect(mockUpdateConfig).toHaveBeenCalledWith({
            security: {
                allow_private_ips: true
            }
        });
    });

    it('toggles response body analysis and updates deviation multiplier', () => {
        render(<AnomaliesTab />);
        const bodyCheckbox = screen.getByLabelText(/Enable Response Body Structural Analysis/i);
        fireEvent.click(bodyCheckbox);
        expect(mockUpdateSettings).toHaveBeenCalledWith({ analyze_response_body: false });

        const multiplierInput = screen.getByDisplayValue('5');
        fireEvent.change(multiplierInput, { target: { value: '3.5' } });
        expect(mockUpdateSettings).toHaveBeenCalledWith({ response_size_anomaly_multiplier: 3.5 });
    });

    it('handles BOLA testing with auth headers, cookies and User B credentials', async () => {
        mockConfig = {
            ...mockConfig,
            global_headers: { Authorization: 'Bearer token', 'X-Custom': 'val' },
            cookies: { session_id: 'sess123' },
            settings: {
                ...mockConfig.settings,
                bola_testing: true,
                auth_headers: ['Authorization'],
                auth_cookies: ['session_id']
            },
            auth_identities: {
                userB: {
                    headers: { Authorization: 'Bearer userB' },
                    cookies: { session_id: 'sessB' }
                }
            }
        };

        render(<AnomaliesTab />);

        expect(screen.getByText('User B (Secondary)')).toBeTruthy();

        // Toggle auth header
        const authHeaderBtn = screen.getByRole('button', { name: /🔒 Authorization/ });
        fireEvent.click(authHeaderBtn);
        expect(mockUpdateSettings).toHaveBeenCalledWith({
            auth_headers: []
        });

        // Toggle auth cookie
        const authCookieBtn = screen.getByRole('button', { name: /🔒 session_id/ });
        fireEvent.click(authCookieBtn);
        expect(mockUpdateSettings).toHaveBeenCalledWith({
            auth_cookies: []
        });
    });

    it('shows warning when BOLA is active but no credentials are selected', () => {
        mockConfig = {
            ...mockConfig,
            settings: {
                ...mockConfig.settings,
                bola_testing: true,
                auth_headers: [],
                auth_cookies: []
            }
        };

        render(<AnomaliesTab />);
        expect(screen.getByText(/No authentication credentials are marked/i)).toBeTruthy();
    });
});
