// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../hooks/useAuth.js', () => ({
    useAuth: () => ({ token: 'test-token' }),
}));

import { RunnerLogsViewer } from './RunnerLogsViewer.js';

function mockFetchOnce(impl: Partial<Response> & { json?: () => any }) {
    (globalThis.fetch as any) = vi.fn().mockResolvedValue({
        ok: impl.ok ?? true,
        status: impl.status ?? 200,
        json: impl.json ?? (async () => ({ logs: [] })),
    });
}

describe('RunnerLogsViewer', () => {
    beforeEach(() => {
        // jsdom has no scrollIntoView
        (Element.prototype as any).scrollIntoView = vi.fn();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows a placeholder and makes no request when runId is null', () => {
        const fetchSpy = (globalThis.fetch = vi.fn());
        render(<RunnerLogsViewer runId={null} />);
        expect(screen.getByText('No scan selected.')).toBeInTheDocument();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('renders parsed log lines and tolerates a malformed payload', async () => {
        mockFetchOnce({
            json: async () => ({
                logs: [
                    { id: '1', scan_id: 's', type: 'runner_log', payload: JSON.stringify({ level: 'ERROR', message: 'boom', timestamp: '2026-01-01T00:00:00Z' }), created_at: '2026-01-01T00:00:00Z' },
                    { id: '2', scan_id: 's', type: 'runner_log', payload: 'not json at all', created_at: '2026-01-01T00:00:01Z' },
                ],
            }),
        });
        render(<RunnerLogsViewer runId="run-1" isRunning={false} />);
        await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
        // the malformed payload falls back to its raw string at INFO level
        expect(screen.getByText('not json at all')).toBeInTheDocument();
    });

    it('shows the empty state on a 404', async () => {
        mockFetchOnce({ ok: false, status: 404 });
        render(<RunnerLogsViewer runId="missing" isRunning={false} />);
        await waitFor(() => expect(screen.getByText('No logs found for this scan.')).toBeInTheDocument());
    });

    it('shows an error message when the request fails', async () => {
        mockFetchOnce({ ok: false, status: 500 });
        render(<RunnerLogsViewer runId="err" isRunning={false} />);
        await waitFor(() => expect(screen.getByText('Failed to fetch runner logs')).toBeInTheDocument());
    });

    it('hides lower-level logs when the level filter is raised', async () => {
        mockFetchOnce({
            json: async () => ({
                logs: [
                    { id: '1', scan_id: 's', type: 'runner_log', payload: JSON.stringify({ level: 'INFO', message: 'just info', timestamp: '2026-01-01T00:00:00Z' }), created_at: 'x' },
                ],
            }),
        });
        render(<RunnerLogsViewer runId="run-1" isRunning={false} />);
        await waitFor(() => expect(screen.getByText('just info')).toBeInTheDocument());

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ERROR' } });
        expect(screen.queryByText('just info')).not.toBeInTheDocument();
        expect(screen.getByText('Logs exist, but are hidden by the current filter.')).toBeInTheDocument();
    });
});
