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
        // Set active tab/subtab
        useAppStore.setState({
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
        expect(privateBadge.style.color).toBe('var(--accent-light)');

        // Verify the Shared badge is rendered
        const sharedBadge = screen.getByText('Shared');
        expect(sharedBadge).toBeTruthy();
        expect(sharedBadge.style.color).toBe('var(--text-secondary)');
    });
});
