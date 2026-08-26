// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import React from 'react';
import { McpTab } from './McpTab.js';
import { useAppStore } from '../../store/appStore.js';

describe('McpTab Component', () => {
    beforeEach(() => {
        useAppStore.setState({
            userProfile: {
                username: 'alice_sec',
                apiKey: 'swazz_live_full_test_key_12345',
                twoFactorEnabled: false
            }
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders setup guides for Claude Desktop and Google Antigravity', () => {
        render(<McpTab />);

        expect(screen.getByText(/Model Context Protocol \(MCP\) Integration/i)).toBeTruthy();
        expect(screen.getByText(/1\. Claude Desktop Setup/i)).toBeTruthy();
        expect(screen.getByText(/2\. Google Antigravity \(AGY\) Setup/i)).toBeTruthy();
        expect(screen.getByDisplayValue('swazz_live_full_test_key_12345')).toBeTruthy();
    });

    it('allows copying plain-text API key', () => {
        const writeTextMock = vi.fn();
        Object.assign(navigator, {
            clipboard: { writeText: writeTextMock }
        });

        render(<McpTab />);

        const copyBtn = screen.getByRole('button', { name: 'Copy' });
        expect(copyBtn).not.toBeDisabled();
        fireEvent.click(copyBtn);

        expect(writeTextMock).toHaveBeenCalledWith('swazz_live_full_test_key_12345');
        expect(screen.getByText('✓ Copied')).toBeTruthy();
    });

    it('disables copy button when API key is masked with dots', () => {
        useAppStore.setState({
            userProfile: {
                username: 'alice_sec',
                apiKey: 'swazz_live_••••••••••••••••••••••••',
                twoFactorEnabled: false
            }
        });

        render(<McpTab />);

        const copyBtn = screen.getByRole('button', { name: 'Copy' });
        expect(copyBtn).toBeDisabled();
        expect(screen.getByText(/API keys are masked for security/i)).toBeTruthy();
    });
});
