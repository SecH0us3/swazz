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

    it('allows switching between all setting tabs', async () => {
        render(<ProjectSettings />);

        // Starts on 'general'
        expect(screen.getByText("Project Details & Target")).toBeTruthy();

        // Switch to Fuzzing & Performance
        const perfTabBtn = screen.getByRole('button', { name: /Fuzzing & Performance/i });
        fireEvent.click(perfTabBtn);
        expect(screen.getByText("Fuzzing Settings & Rate Limits")).toBeTruthy();

        // Switch to Anomalies & Security
        const anomaliesTabBtn = screen.getByRole('button', { name: /Anomalies & Security/i });
        fireEvent.click(anomaliesTabBtn);
        expect(screen.getByText("Vulnerability & Anomaly Analysis")).toBeTruthy();

        // Switch to Wordlist Files
        const wordlistTabBtn = screen.getByRole('button', { name: /Wordlist Files/i });
        fireEvent.click(wordlistTabBtn);
        expect(screen.getByText("Wordlist Files Configuration")).toBeTruthy();

        // Switch to Request Chaining
        const chainingTabBtn = screen.getByRole('button', { name: /Request Chaining/i });
        fireEvent.click(chainingTabBtn);
        expect(screen.getByText("Request Chaining Rules")).toBeTruthy();

        // Switch to Raw JSON Config
        const rawTabBtn = screen.getByRole('button', { name: /Raw JSON Config/i });
        fireEvent.click(rawTabBtn);
        expect(screen.getByText("Raw JSON Configuration")).toBeTruthy();
    });

    it('handles General Tab updates and deletion', async () => {
        const fetchSpy = vi.spyOn(window, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({})
        } as Response);

        render(<ProjectSettings />);
        
        // General Tab is active by default. Let's find fields and change values
        const nameInput = screen.getByDisplayValue('Test Proj');
        fireEvent.change(nameInput, { target: { value: 'New Project Name' } });

        const descInput = screen.getByDisplayValue('desc');
        fireEvent.change(descInput, { target: { value: 'New Description' } });

        const urlInput = screen.getByPlaceholderText('e.g. https://api.production.internal');
        fireEvent.change(urlInput, { target: { value: 'https://new-api.com' } });

        // Save changes
        const saveBtn = screen.getByRole('button', { name: /Save General Info/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(fetchSpy).toHaveBeenCalledWith('/api/projects/test-project-1', expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({ name: 'New Project Name', description: 'New Description' })
            }));
        });

        // Test project deletion
        const deleteBtn = screen.getByRole('button', { name: /Delete Project/i });
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('New Project Name');
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

        fireEvent.click(deleteBtn);

        await waitFor(() => {
            expect(promptSpy).toHaveBeenCalled();
            expect(fetchSpy).toHaveBeenCalledWith('/api/projects/test-project-1', expect.objectContaining({
                method: 'DELETE'
            }));
            expect(alertSpy).toHaveBeenCalledWith('Project deleted successfully.');
        });
    });

    it('handles Performance Tab updates', async () => {
        render(<ProjectSettings />);

        // Switch to Performance Tab
        const perfTabBtn = screen.getByRole('button', { name: /Fuzzing & Performance/i });
        fireEvent.click(perfTabBtn);

        // Change target timeout input (default 2000)
        const timeoutInput = screen.getByDisplayValue('2000');
        fireEvent.change(timeoutInput, { target: { value: '2500' } });
        expect(timeoutInput.getAttribute('value')).toBe('2500');

        // Change delay input (default 0)
        const delayInput = screen.getByDisplayValue('0');
        fireEvent.change(delayInput, { target: { value: '50' } });
        expect(delayInput.getAttribute('value')).toBe('50');
    });

    it('handles Anomalies Tab updates', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
        render(<ProjectSettings />);

        // Switch to Anomalies Tab
        const anomaliesTabBtn = screen.getByRole('button', { name: /Anomalies & Security/i });
        fireEvent.click(anomaliesTabBtn);

        // Try to add an invalid ignore code
        const ignoreInput = screen.getByPlaceholderText('e.g. 404');
        const addBtn = screen.getByRole('button', { name: /Add/i });

        fireEvent.change(ignoreInput, { target: { value: 'abc' } });
        fireEvent.click(addBtn);
        expect(alertSpy).toHaveBeenCalledWith('Please enter a valid 3-digit HTTP status code (100-599).');

        // Add a valid ignore code
        fireEvent.change(ignoreInput, { target: { value: '404' } });
        fireEvent.click(addBtn);

        // Check if 404 is visible
        expect(screen.getByText('404')).toBeTruthy();

        // Change time-delay anomaly threshold (default 4000)
        const timeAnomalyInput = screen.getByDisplayValue('4000');
        fireEvent.change(timeAnomalyInput, { target: { value: '4500' } });
        expect(timeAnomalyInput.getAttribute('value')).toBe('4500');
    });

    it('handles Raw JSON Config Tab updates', async () => {
        render(<ProjectSettings />);

        // Switch to Raw JSON Config Tab
        const rawTabBtn = screen.getByRole('button', { name: /Raw JSON Config/i });
        fireEvent.click(rawTabBtn);

        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

        // Input invalid JSON
        fireEvent.change(textarea, { target: { value: '{invalid-json' } });
        expect(screen.getByText(/Invalid JSON:/i)).toBeTruthy();

        // Input valid JSON
        fireEvent.change(textarea, { target: { value: '{"base_url": "https://valid.com"}' } });
        
        // Save
        const saveBtn = screen.getByRole('button', { name: /Save Configuration/i });
        fireEvent.click(saveBtn);
        expect(screen.getByText(/Configuration updated successfully/i)).toBeTruthy();
    });
});
