import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { UserSettings } from './UserSettings.js';
import { useAppStore } from '../store/appStore.js';

describe('UserSettings Component', () => {
    beforeEach(() => {
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

    it('renders account details subtab by default', () => {
        render(<UserSettings />);

        expect(screen.getByText('Settings')).toBeTruthy();
        expect(screen.getByDisplayValue('testdeveloper')).toBeTruthy();
        expect(screen.getByDisplayValue('test-api-key-12345')).toBeTruthy();
    });

    it('can switch to Security subtab and show 2FA instructions', () => {
        render(<UserSettings />);

        // Switch to Security subtab
        const securityTabBtn = screen.getByRole('button', { name: /Security/i });
        fireEvent.click(securityTabBtn);

        expect(screen.getByText('Two-Factor Authentication (2FA)')).toBeTruthy();
        expect(screen.getByText(/Add an extra layer of security/i)).toBeTruthy();
    });

    it('can switch to Danger Zone subtab and show deletion warnings', () => {
        render(<UserSettings />);

        // Switch to Danger Zone subtab
        const dangerTabBtn = screen.getByRole('button', { name: /Danger Zone/i });
        fireEvent.click(dangerTabBtn);

        expect(screen.getByText('Delete My Account & Data')).toBeTruthy();
    });

    it('can switch to MCP Integration subtab and show setups', () => {
        render(<UserSettings />);

        // Switch to MCP Integration subtab
        const mcpTabBtn = screen.getByRole('button', { name: /MCP Integration/i });
        fireEvent.click(mcpTabBtn);

        expect(screen.getByText('Model Context Protocol (MCP) Integration')).toBeTruthy();
        expect(screen.getByText(/Claude Desktop Setup/i)).toBeTruthy();
        expect(screen.getAllByText(/Google Antigravity/i).length).toBeGreaterThan(0);
    });
});
