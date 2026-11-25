// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { ChainingTab } from './ChainingTab.js';
import { useConfig } from '../../hooks/useConfig.js';

vi.mock('../../hooks/useConfig.js', () => ({
    useConfig: vi.fn(),
}));

describe('ChainingTab auto-chaining toggle', () => {
    let mockUpdateSettings: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockUpdateSettings = vi.fn();
        (useConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            config: {
                settings: {
                    chaining_rules: [],
                },
            },
            updateSettings: mockUpdateSettings,
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('defaults Automatic Request Chaining (DAG) checkbox to checked when undefined and toggles false on click', () => {
        render(<ChainingTab />);
        const checkbox = screen.getByRole('checkbox', { name: /Automatic Request Chaining/i }) as HTMLInputElement;
        expect(checkbox.checked).toBe(true);

        fireEvent.click(checkbox);
        expect(mockUpdateSettings).toHaveBeenCalledWith({ enable_auto_chaining: false });
    });

    it('renders unchecked when enable_auto_chaining is explicitly false', () => {
        (useConfig as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            config: {
                settings: {
                    enable_auto_chaining: false,
                    chaining_rules: [],
                },
            },
            updateSettings: mockUpdateSettings,
        });

        render(<ChainingTab />);
        const checkbox = screen.getByRole('checkbox', { name: /Automatic Request Chaining/i }) as HTMLInputElement;
        expect(checkbox.checked).toBe(false);
    });
});
