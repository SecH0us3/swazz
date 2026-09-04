// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { WafAnalysisTab } from './WafAnalysisTab';
import { useConfig } from '../../hooks/useConfig.js';
import { useAppStore } from '../../store/appStore.js';

vi.mock('../../hooks/useConfig.js', () => ({
    useConfig: vi.fn()
}));

describe('WafAnalysisTab', () => {
    let mockUpdateSettings: ReturnType<typeof vi.fn>;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockUpdateSettings = vi.fn();
        (useConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            config: {
                base_url: 'https://example.com',
                settings: {
                    waf_check_enabled: false
                }
            },
            updateSettings: mockUpdateSettings
        });

        mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);
        useAppStore.setState({ csrfToken: 'test-csrf-token' });
        if (typeof localStorage !== 'undefined' && localStorage) {
            localStorage.clear();
        }
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renders the WAF analysis checkbox in unchecked state initially', () => {
        render(<WafAnalysisTab />);
        const checkbox = screen.getByRole('checkbox', { name: /Enable Pre-Scan WAF Fingerprinting/i });
        expect(checkbox).not.toBeChecked();
    });

    it('toggles waf_check_enabled setting on click', () => {
        render(<WafAnalysisTab />);
        const checkbox = screen.getByRole('checkbox', { name: /Enable Pre-Scan WAF Fingerprinting/i });
        fireEvent.click(checkbox);
        expect(mockUpdateSettings).toHaveBeenCalledWith({ waf_check_enabled: true });
    });

    it('renders checked when waf_check_enabled is true in config', () => {
        (useConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            config: {
                base_url: 'https://example.com',
                settings: {
                    waf_check_enabled: true
                }
            },
            updateSettings: mockUpdateSettings
        });

        render(<WafAnalysisTab />);
        const checkbox = screen.getByRole('checkbox', { name: /Enable Pre-Scan WAF Fingerprinting/i });
        expect(checkbox).toBeChecked();
    });
});
