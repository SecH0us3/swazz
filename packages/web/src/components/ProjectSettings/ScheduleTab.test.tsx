// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ScheduleTab } from './ScheduleTab.js';
import { useAppStore } from '../../store/appStore.js';

const mockShowToast = vi.fn();
vi.mock('../../hooks/useToast.js', () => ({
    useToast: () => ({
        showToast: mockShowToast,
        toasts: []
    })
}));

describe('ScheduleTab Component', () => {
    let mockFetch: any;

    const mockProject = {
        id: 'proj-schedule-1',
        name: 'Scheduled Proj',
        role: 'owner',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z'
    };

    beforeEach(() => {
        mockShowToast.mockClear();
        localStorage.clear();
        localStorage.setItem('swazz_token', 'test-schedule-token');

        mockFetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
            if (url.includes('/config')) {
                return {
                    ok: true,
                    json: async () => ({
                        cron_schedule: '0 0 * * *',
                        last_run_at: '2026-09-15T10:00:00.000Z'
                    })
                };
            }
            if (url.includes('/schedule') && opts?.method === 'POST') {
                return {
                    ok: true,
                    json: async () => ({ success: true })
                };
            }
            return { ok: true, json: async () => ({}) };
        });
        global.fetch = mockFetch;

        useAppStore.setState({
            activeProject: { ...mockProject } as any,
            userProfile: { username: 'testuser', apiKey: 'key' } as any
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('loads schedule config and displays daily selection and last run timestamp', async () => {
        render(<ScheduleTab />);

        expect(screen.getByText(/Loading schedule settings\.\.\./i)).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.getByText(/Auto-Scan Scheduler/i)).toBeInTheDocument();
        });

        const select = screen.getByRole('combobox');
        expect(select).toHaveValue('daily');

        expect(screen.getByText(/Last automatic run triggered at:/i)).toBeInTheDocument();
    });

    it('sets disabled when cron_schedule is null or empty', async () => {
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes('/config')) {
                return {
                    ok: true,
                    json: async () => ({ cron_schedule: null, last_run_at: null })
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('disabled');
        });
        expect(screen.queryByText(/Last automatic run triggered at:/i)).not.toBeInTheDocument();
    });

    it('sets weekly when cron_schedule is 0 0 * * 0', async () => {
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes('/config')) {
                return {
                    ok: true,
                    json: async () => ({ cron_schedule: '0 0 * * 0' })
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('weekly');
        });
    });

    it('sets custom when cron_schedule is a custom expression', async () => {
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes('/config')) {
                return {
                    ok: true,
                    json: async () => ({ cron_schedule: '30 2 * * 1-5' })
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('custom');
            expect(screen.getByDisplayValue('30 2 * * 1-5')).toBeInTheDocument();
        });
    });

    it('handles fetch error gracefully during initial load', async () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes('/config')) {
                throw new Error('Network timeout');
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByText(/Auto-Scan Scheduler/i)).toBeInTheDocument();
        });

        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[swazz] Failed to load schedule config:'),
            expect.any(Error)
        );
        consoleWarnSpy.mockRestore();
    });

    it('saves daily schedule successfully', async () => {
        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('daily');
        });

        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/projects/proj-schedule-1/schedule',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-schedule-token',
                        'Content-Type': 'application/json'
                    }),
                    body: JSON.stringify({ cron_schedule: '0 0 * * *' })
                })
            );
            expect(mockShowToast).toHaveBeenCalledWith('Schedule settings saved successfully', 'success');
        });
    });

    it('saves weekly schedule successfully', async () => {
        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('daily');
        });

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'weekly' } });

        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/projects/proj-schedule-1/schedule',
                expect.objectContaining({
                    body: JSON.stringify({ cron_schedule: '0 0 * * 0' })
                })
            );
            expect(mockShowToast).toHaveBeenCalledWith('Schedule settings saved successfully', 'success');
        });
    });

    it('saves disabled schedule (null cron_schedule)', async () => {
        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('daily');
        });

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'disabled' } });

        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/projects/proj-schedule-1/schedule',
                expect.objectContaining({
                    body: JSON.stringify({ cron_schedule: null })
                })
            );
            expect(mockShowToast).toHaveBeenCalledWith('Schedule settings saved successfully', 'success');
        });
    });

    it('validates custom cron: rejects non-5-field expressions', async () => {
        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('daily');
        });

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'custom' } });

        const input = screen.getByPlaceholderText('e.g. 0 12 * * *');
        fireEvent.change(input, { target: { value: '0 0 * *' } }); // only 4 fields

        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
        fireEvent.click(saveBtn);

        expect(mockShowToast).toHaveBeenCalledWith('Invalid cron expression. Must have exactly 5 fields.', 'error');
        expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/schedule'), expect.anything());
    });

    it('validates custom cron: rejects expressions with minute or hour wildcards/frequencies', async () => {
        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('daily');
        });

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'custom' } });

        const input = screen.getByPlaceholderText('e.g. 0 12 * * *');
        
        // Test wildcard minute
        fireEvent.change(input, { target: { value: '* 12 * * *' } });
        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
        fireEvent.click(saveBtn);

        expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining('Frequency limit: schedule cannot be more frequent than once a day'),
            'error'
        );

        // Test out-of-range hour
        mockShowToast.mockClear();
        fireEvent.change(input, { target: { value: '15 25 * * *' } });
        fireEvent.click(saveBtn);

        expect(mockShowToast).toHaveBeenCalledWith(
            expect.stringContaining('Frequency limit: schedule cannot be more frequent than once a day'),
            'error'
        );
    });

    it('saves valid custom cron expression', async () => {
        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('daily');
        });

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'custom' } });

        const input = screen.getByPlaceholderText('e.g. 0 12 * * *');
        fireEvent.change(input, { target: { value: '30 3 * * 2' } });

        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                '/api/projects/proj-schedule-1/schedule',
                expect.objectContaining({
                    body: JSON.stringify({ cron_schedule: '30 3 * * 2' })
                })
            );
            expect(mockShowToast).toHaveBeenCalledWith('Schedule settings saved successfully', 'success');
        });
    });

    it('displays error when backend rejects schedule save', async () => {
        mockFetch.mockImplementation(async (url: string, opts?: any) => {
            if (url.includes('/config')) {
                return {
                    ok: true,
                    json: async () => ({ cron_schedule: '0 0 * * *' })
                };
            }
            if (url.includes('/schedule') && opts?.method === 'POST') {
                return {
                    ok: false,
                    json: async () => ({ error: 'Plan upgrade required for scheduler' })
                };
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('daily');
        });

        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockShowToast).toHaveBeenCalledWith('Plan upgrade required for scheduler', 'error');
        });
    });

    it('displays error when save request throws network error', async () => {
        mockFetch.mockImplementation(async (url: string, opts?: any) => {
            if (url.includes('/config')) {
                return {
                    ok: true,
                    json: async () => ({ cron_schedule: '0 0 * * *' })
                };
            }
            if (url.includes('/schedule') && opts?.method === 'POST') {
                throw new Error('Connection reset');
            }
            return { ok: true, json: async () => ({}) };
        });

        render(<ScheduleTab />);

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toHaveValue('daily');
        });

        const saveBtn = screen.getByRole('button', { name: /Save Schedule/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockShowToast).toHaveBeenCalledWith('Connection reset', 'error');
        });
    });

    it('skips loading when activeProject or token is missing', async () => {
        useAppStore.setState({ activeProject: null });

        render(<ScheduleTab />);

        // Should immediately show the content without infinite loading
        expect(screen.getByText(/Auto-Scan Scheduler/i)).toBeInTheDocument();
    });
});
