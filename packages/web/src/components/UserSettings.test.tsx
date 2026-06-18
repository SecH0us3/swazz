import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
                publicKey: '9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a'
            }
        });
    });

    it('renders account details and api key', () => {
        render(<UserSettings />);

        expect(screen.getByText('Settings')).toBeTruthy();
        expect(screen.getByDisplayValue('testdeveloper')).toBeTruthy();
        expect(screen.getByDisplayValue('test-api-key-12345')).toBeTruthy();
    });

    it('toggles runner modes and shows correct badges/commands', async () => {
        render(<UserSettings />);

        // Default tab is Private Runner
        expect(screen.getByText('Private Mode:')).toBeTruthy();
        expect(screen.queryByText('Shared Mode:')).toBeNull();
        expect(screen.getByText(/docker run.*swazz_runner\.key/)).toBeTruthy();

        // Click Shared Runner tab
        const sharedTabBtn = screen.getByRole('button', { name: /Shared Runner/i });
        fireEvent.click(sharedTabBtn);

        // Now it should show Shared Runner instructions and warnings
        expect(screen.getByText('Shared Mode:')).toBeTruthy();
        expect(screen.queryByText('Private Mode:')).toBeNull();
        expect(screen.getByText('⚠️ Critical Security Warning')).toBeTruthy();
        expect(screen.getByText(/docker run.*--token test-api-key-12345/)).toBeTruthy();

        // Click back to Private Runner tab
        const privateTabBtn = screen.getByRole('button', { name: /Private Runner/i });
        fireEvent.click(privateTabBtn);
        expect(screen.getByText('Private Mode:')).toBeTruthy();
    });

    it('handles swazz_runner.pub file upload', async () => {
        render(<UserSettings />);

        // Find file upload input
        const fileInput = document.getElementById('pubkey-file') as HTMLInputElement;
        expect(fileInput).toBeTruthy();

        // Mock FileReader
        const mockFileContent = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
        const file = new File([mockFileContent], 'swazz_runner.pub', { type: 'text/plain' });

        // Trigger change
        fireEvent.change(fileInput, { target: { files: [file] } });

        // Since FileReader is asynchronous, wait for value update in the input
        await waitFor(() => {
            const hexInput = screen.getByPlaceholderText(/Enter hex-encoded public key/i) as HTMLInputElement;
            expect(hexInput.value).toBe(mockFileContent);
        });
    });
});
