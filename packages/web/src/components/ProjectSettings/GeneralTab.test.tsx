// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GeneralTab } from './GeneralTab.js';
import { useAppStore } from '../../store/appStore.js';

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast.js', () => ({
    useToast: () => ({
        showToast: mockShowToast,
        toasts: []
    })
}));

describe('GeneralTab Component', () => {
    let mockFetch: any;

    const mockProject = {
        id: 'proj-general-1',
        name: 'Alpha Project',
        description: 'Alpha description',
        member_session_timeout: 3600,
        role: 'owner',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
    };

    const mockProject2 = {
        id: 'proj-general-2',
        name: 'Beta Project',
        description: 'Beta description',
        member_session_timeout: 0,
        role: 'member',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z'
    };

    let patchResponse: { ok: boolean; json?: () => Promise<any> };
    let deleteResponse: { ok: boolean };

    beforeEach(() => {
        mockShowToast.mockClear();
        localStorage.clear();
        localStorage.setItem('swazz_token', 'test-token-xyz');
        localStorage.setItem('swazz:config', JSON.stringify({
            base_url: 'https://example.com/api',
            settings: {
                data_retention: '30_days',
                disable_shared_runners: false
            }
        }));

        patchResponse = { ok: true, json: async () => ({}) };
        deleteResponse = { ok: true };

        mockFetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
            if (url.includes('/config') && (!opts?.method || opts.method === 'GET')) {
                return {
                    ok: true,
                    json: async () => ({
                        config: {
                            base_url: 'https://example.com/api',
                            settings: {
                                data_retention: '30_days',
                                disable_shared_runners: false
                            }
                        }
                    })
                };
            }
            if (opts?.method === 'PATCH') {
                return patchResponse;
            }
            if (opts?.method === 'DELETE') {
                return deleteResponse;
            }
            return { ok: true, json: async () => ({}) };
        });
        global.fetch = mockFetch;

        useAppStore.setState({
            activeProject: { ...mockProject } as any,
            projects: [{ ...mockProject }, { ...mockProject2 }] as any,
            activeTab: 'project_settings',
            loadedRunId: null,
            liveRunId: null,
            stats: null,
            historyStats: null,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders project fields with active project data', async () => {
        render(<GeneralTab />);

        expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Alpha description')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByDisplayValue('https://example.com/api')).toBeInTheDocument();
        });
        expect(screen.getByDisplayValue('30 Days')).toBeInTheDocument();
    });

    it('syncs form state when activeProject changes in store', async () => {
        const { rerender } = render(<GeneralTab />);

        expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument();

        // Switch project in store
        useAppStore.setState({
            activeProject: { ...mockProject2 } as any
        });
        rerender(<GeneralTab />);

        await waitFor(() => {
            expect(screen.getByDisplayValue('Beta Project')).toBeInTheDocument();
            expect(screen.getByDisplayValue('Beta description')).toBeInTheDocument();
        });
    });

    it('saves general settings successfully and displays success banner', async () => {
        render(<GeneralTab />);

        const nameInput = screen.getByDisplayValue('Alpha Project');
        fireEvent.change(nameInput, { target: { value: 'Alpha Renamed' } });

        const descInput = screen.getByDisplayValue('Alpha description');
        fireEvent.change(descInput, { target: { value: 'New description' } });

        const urlInput = screen.getByDisplayValue('https://example.com/api');
        fireEvent.change(urlInput, { target: { value: 'https://new-api.example.com/' } });

        const submitBtn = screen.getByRole('button', { name: /Save General Info/i });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/projects/proj-general-1',
                expect.objectContaining({
                    method: 'PATCH',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-token-xyz',
                        'Content-Type': 'application/json'
                    }),
                    body: JSON.stringify({
                        name: 'Alpha Renamed',
                        description: 'New description',
                        member_session_timeout: 3600
                    })
                })
            );
        });

        await waitFor(() => {
            expect(screen.getByText(/Saved successfully/i)).toBeInTheDocument();
        });

        // Store should be updated with new project name
        const state = useAppStore.getState();
        expect(state.activeProject?.name).toBe('Alpha Renamed');
    });

    it('handles save error when backend responds with error message', async () => {
        patchResponse = {
            ok: false,
            json: async () => ({ error: 'Project name is taken' })
        };

        render(<GeneralTab />);

        const submitBtn = screen.getByRole('button', { name: /Save General Info/i });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(screen.getByText(/Error: Project name is taken/i)).toBeInTheDocument();
        });
    });

    it('handles save error when backend response is not ok and json parse fails', async () => {
        patchResponse = {
            ok: false,
            json: async () => { throw new Error('invalid json'); }
        };

        render(<GeneralTab />);

        const submitBtn = screen.getByRole('button', { name: /Save General Info/i });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(screen.getByText(/Error: Failed to update project details/i)).toBeInTheDocument();
        });
    });

    it('updates data retention setting in config', () => {
        render(<GeneralTab />);

        const retentionSelect = screen.getByDisplayValue('30 Days');
        fireEvent.change(retentionSelect, { target: { value: '1_year' } });

        expect(useAppStore.getState().config.settings.data_retention).toBe('1_year');
    });

    it('updates member session timeout in state and submits it', async () => {
        render(<GeneralTab />);

        const timeoutSelect = screen.getByDisplayValue('1 Hour');
        fireEvent.change(timeoutSelect, { target: { value: '86400' } });

        const submitBtn = screen.getByRole('button', { name: /Save General Info/i });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/projects/proj-general-1',
                expect.objectContaining({
                    body: expect.stringContaining('"member_session_timeout":86400')
                })
            );
        });
    });

    it('toggles disable shared runners option', () => {
        render(<GeneralTab />);

        const checkbox = screen.getByLabelText(/Disable Shared Runners/i);
        expect(checkbox).not.toBeChecked();

        fireEvent.click(checkbox);
        expect(useAppStore.getState().config.settings.disable_shared_runners).toBe(true);
    });

    it('handles delete project: user cancels prompt', async () => {
        vi.spyOn(window, 'prompt').mockReturnValue(null);

        render(<GeneralTab />);

        const deleteBtn = screen.getByRole('button', { name: /Delete Project/i });
        fireEvent.click(deleteBtn);

        expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('DELETE'));
        expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('handles delete project: user types incorrect name', async () => {
        vi.spyOn(window, 'prompt').mockReturnValue('Wrong Name');

        render(<GeneralTab />);

        const deleteBtn = screen.getByRole('button', { name: /Delete Project/i });
        fireEvent.click(deleteBtn);

        expect(mockShowToast).toHaveBeenCalledWith('Project name mismatch. Deletion cancelled.', 'error');
        expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('DELETE'));
    });

    it('handles delete project: successful deletion and switches to remaining project', async () => {
        vi.spyOn(window, 'prompt').mockReturnValue('Alpha Project');

        render(<GeneralTab />);

        const deleteBtn = screen.getByRole('button', { name: /Delete Project/i });
        fireEvent.click(deleteBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/projects/proj-general-1',
                expect.objectContaining({ method: 'DELETE' })
            );
            expect(mockShowToast).toHaveBeenCalledWith('Project deleted successfully.', 'success');
        });

        const state = useAppStore.getState();
        expect(state.projects).toHaveLength(1);
        expect(state.activeProject?.id).toBe('proj-general-2');
    });

    it('handles delete project: deletion failure shows error toast', async () => {
        vi.spyOn(window, 'prompt').mockReturnValue('Alpha Project');
        deleteResponse = { ok: false };

        render(<GeneralTab />);

        const deleteBtn = screen.getByRole('button', { name: /Delete Project/i });
        fireEvent.click(deleteBtn);

        await waitFor(() => {
            expect(mockShowToast).toHaveBeenCalledWith('Deletion request failed', 'error');
        });
    });

    it('does nothing when handleSaveGeneral or handleDeleteProject called without activeProject', async () => {
        useAppStore.setState({ activeProject: null });

        render(<GeneralTab />);

        const deleteBtn = screen.getByRole('button', { name: /Delete Project/i });
        fireEvent.click(deleteBtn);

        expect(mockFetch).not.toHaveBeenCalled();
    });
});
