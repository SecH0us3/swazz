import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { ProjectSettings } from './ProjectSettings.js';
import { useAppStore } from '../store/appStore.js';

describe('ProjectSettings Component — Runners Tab', () => {
    const mockRunners = [
        { name: 'PrivateRunnerOne', publicKey: '9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a', status: 'connected', isMine: true, isShared: false },
        { name: 'SharedRunnerTwo', publicKey: null, status: 'connected', isMine: false, isShared: true }
    ];

    beforeEach(() => {
        // Set up store state
        useAppStore.setState({
            userProfile: {
                username: 'testdeveloper',
                apiKey: 'test-api-key-12345',
                publicKey: '9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a'
            },
            activeProject: { id: 'test-project-1', name: 'Test Proj', description: 'desc' },
            projects: [{ id: 'test-project-1', name: 'Test Proj', description: 'desc' }]
        });

        // Mock window.fetch for runners list
        vi.spyOn(window, 'fetch').mockImplementation((url) => {
            if (url === '/api/runners') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ runners: mockRunners })
                } as Response);
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({})
            } as Response);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders runners with correct Shared and Private badges', async () => {
        render(<ProjectSettings />);

        // Click on the Active Runners tab button to trigger loading
        const runnersTabBtn = screen.getByRole('button', { name: /Active Runners/i });
        fireEvent.click(runnersTabBtn);

        // Wait for runners list to load and table cells to render
        await waitFor(() => {
            expect(screen.getByText('PrivateRunnerOne')).toBeTruthy();
            expect(screen.getByText('SharedRunnerTwo')).toBeTruthy();
        });

        // Verify the Private badge is rendered
        const privateBadge = screen.getByText('Private');
        expect(privateBadge).toBeTruthy();
        expect(privateBadge.className).toBe('runners-mode-badge-private');

        // Verify the Shared badge is rendered
        const sharedBadge = screen.getByText('Shared');
        expect(sharedBadge).toBeTruthy();
        expect(sharedBadge.className).toBe('runners-mode-badge-shared');
    });

    it('toggles runner modes and shows correct badges/commands', async () => {
        render(<ProjectSettings />);

        // Click on the Active Runners tab button
        const runnersTabBtn = screen.getByRole('button', { name: /Active Runners/i });
        fireEvent.click(runnersTabBtn);

        // Default runner guide mode is Private Runner
        await waitFor(() => {
            expect(screen.getByText('Private Mode:')).toBeTruthy();
        });
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
        render(<ProjectSettings />);

        // Click on the Active Runners tab button
        const runnersTabBtn = screen.getByRole('button', { name: /Active Runners/i });
        fireEvent.click(runnersTabBtn);

        // Wait for upload button to be rendered
        await waitFor(() => {
            expect(document.getElementById('pubkey-file')).toBeTruthy();
        });

        const fileInput = document.getElementById('pubkey-file') as HTMLInputElement;

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
