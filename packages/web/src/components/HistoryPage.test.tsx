// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

vi.mock('../hooks/useToast.js', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../hooks/useFeatureGate.js', () => ({ useFeatureGate: () => ({ unlocked: true }) }));

import { HistoryPage } from './HistoryPage.js';
import { useAppStore } from '../store/appStore.js';
import type { ScanRun } from '../hooks/useDb.js';

function run(id: string, over: Partial<ScanRun> = {}): ScanRun {
    return {
        id,
        startedAt: 1_000_000,
        completedAt: 1_060_000, // completed, 60s, no 5xx -> "completed"
        baseUrl: 'https://api.test',
        stats: { statusCounts: { '200': 10 } } as any,
        ...over,
    };
}

function mountProps() {
    return {
        runs: [] as ScanRun[],
        onLoadRun: vi.fn(),
        onDeleteRun: vi.fn(),
        onImportRun: vi.fn(),
        onExport: vi.fn(),
        onExportHTML: vi.fn(),
        onExportMD: vi.fn(),
    };
}

describe('HistoryPage', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/');
        localStorage.removeItem('swazz_token');
        useAppStore.setState({ loadedRunId: null, liveRunId: null, activeProject: null } as any);
    });
    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        window.history.replaceState({}, '', '/');
        localStorage.removeItem('swazz_token');
    });

    it('shows the empty state when there are no runs', () => {
        render(<HistoryPage {...mountProps()} />);
        expect(screen.getByText('No scan history yet')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Import JSON Report/i })).toBeInTheDocument();
    });

    it('renders a row and the tab counts for the runs', () => {
        const p = { ...mountProps(), runs: [run('r1'), run('r2')] };
        render(<HistoryPage {...p} />);
        // All tab badge shows 2
        const allTab = screen.getByRole('button', { name: /^All/ });
        expect(within(allTab).getByText('2')).toBeInTheDocument();
        // two "Load Run" buttons (one per row)
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(2);
    });

    it('calls onLoadRun and marks the already-loaded run as disabled', () => {
        const p = { ...mountProps(), runs: [run('r1')] };
        useAppStore.setState({ loadedRunId: null } as any);
        const { rerender } = render(<HistoryPage {...p} />);
        fireEvent.click(screen.getByRole('button', { name: 'Load Run' }));
        expect(p.onLoadRun).toHaveBeenCalledWith('r1');

        useAppStore.setState({ loadedRunId: 'r1' } as any);
        rerender(<HistoryPage {...p} />);
        const loaded = screen.getByRole('button', { name: /Loaded/ });
        expect(loaded).toBeDisabled();
    });

    it('deletes only after confirmation', () => {
        const p = { ...mountProps(), runs: [run('r1')] };
        render(<HistoryPage {...p} />);
        const del = screen.getByTitle('Delete Scan Run');

        vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
        fireEvent.click(del);
        expect(p.onDeleteRun).not.toHaveBeenCalled();

        vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
        fireEvent.click(del);
        expect(p.onDeleteRun).toHaveBeenCalledWith('r1');
    });

    it('shows the empty-category message when a tab has no runs', () => {
        // a single completed run -> the "Failed" tab is empty
        const p = { ...mountProps(), runs: [run('r1')] };
        render(<HistoryPage {...p} />);
        fireEvent.click(screen.getByRole('button', { name: /^Failed/ }));
        expect(screen.getByText('No scans found in this category')).toBeInTheDocument();
    });

    it('classifies a run with 5xx responses under the Failed tab', () => {
        const failed = run('bad', { stats: { statusCounts: { '200': 1, '500': 3 } } as any });
        const p = { ...mountProps(), runs: [failed] };
        render(<HistoryPage {...p} />);
        const failedTab = screen.getByRole('button', { name: /^Failed/ });
        expect(within(failedTab).getByText('1')).toBeInTheDocument();
        // it is absent from the Completed tab
        fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
        expect(screen.getByText('No scans found in this category')).toBeInTheDocument();
    });

    // A scan that failed without a single 5xx (it never got to send requests) is still failed,
    // and says why.
    it('classifies a run that failed under the Failed tab, with its reason', () => {
        const failed = run('mcp', { failureReason: 'could not connect to the MCP server: status 401' });
        const p = { ...mountProps(), runs: [failed] };
        render(<HistoryPage {...p} />);
        expect(within(screen.getByRole('button', { name: /^Failed/ })).getByText('1')).toBeInTheDocument();
        expect(screen.getByText('Failed: could not connect to the MCP server: status 401')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^Completed/ }));
        expect(screen.getByText('No scans found in this category')).toBeInTheDocument();
    });

    it('routes each export format to the matching callback', () => {
        const p = { ...mountProps(), runs: [run('r1')] };
        render(<HistoryPage {...p} />);
        const select = screen.getByRole('combobox');

        fireEvent.change(select, { target: { value: 'html' } });
        expect(p.onExportHTML).toHaveBeenCalledWith('r1');

        fireEvent.change(select, { target: { value: 'md' } });
        expect(p.onExportMD).toHaveBeenCalledWith('r1');

        fireEvent.change(select, { target: { value: 'json' } });
        expect(p.onExport).toHaveBeenCalledWith('r1', 'https://api.test');
    });

    it('selecting two runs and pressing Compare sets the store and switches to the compare tab', () => {
        const older = run('old', { startedAt: 1000 });
        const newer = run('new', { startedAt: 2000 });
        const p = { ...mountProps(), runs: [newer, older] };
        render(<HistoryPage {...p} />);

        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]);
        fireEvent.click(checkboxes[1]);
        expect(screen.getByText(/scans selected for comparison/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Compare Scans/ }));
        const s = useAppStore.getState() as any;
        // older run is assigned as A regardless of selection order
        expect(s.compareRunIdA).toBe('old');
        expect(s.compareRunIdB).toBe('new');
        expect(s.activeTab).toBe('compare');
    });

    it('imports a CLI report and loads the imported run', async () => {
        const p = {
            ...mountProps(),
            runs: [run('r1')],
            onImportRun: vi.fn(async () => ({ runId: 'imported-1', run: { id: 'imported-1' } })),
        };
        const { container } = render(<HistoryPage {...p} />);
        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File([JSON.stringify({ scan: 'data' })], 'report.json', { type: 'application/json' });

        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(p.onImportRun).toHaveBeenCalledWith({ scan: 'data' }));
        await waitFor(() => expect(p.onLoadRun).toHaveBeenCalledWith('imported-1', { id: 'imported-1' }));
    });

    it('filters by Target Base URL case-insensitively with special characters and clears search cleanly', () => {
        const runs = [
            run('r1', { baseUrl: 'https://api.alpha.example/v1' }),
            run('r2', { baseUrl: 'https://staging.beta.example/100%_test\\path' }),
            run('r3', { baseUrl: 'https://api.gamma.example/v2' }),
        ];
        render(<HistoryPage {...mountProps()} runs={runs} />);

        const searchInput = screen.getByLabelText('Target Base URL');
        fireEvent.change(searchInput, { target: { value: 'BETA.EXAMPLE/100%_test\\path' } });

        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(1);
        expect(screen.getByText('staging.beta.example/100%_test\\path')).toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: /^All/ })).getByText('1')).toBeInTheDocument();

        const clearSearchBtn = screen.getByRole('button', { name: 'Clear target URL search' });
        fireEvent.click(clearSearchBtn);
        expect((searchInput as HTMLInputElement).value).toBe('');
        expect(document.activeElement).toBe(searchInput);
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(3);
    });

    it('filters by date range with inclusive local day boundaries and combines with URL search', () => {
        const oct1Start = new Date(2026, 9, 1, 0, 0, 0, 0).getTime();
        const oct1End = new Date(2026, 9, 1, 23, 59, 59, 999).getTime();
        const oct2Start = new Date(2026, 9, 2, 0, 0, 0, 0).getTime();
        const sep30End = new Date(2026, 8, 30, 23, 59, 59, 999).getTime();

        const runs = [
            run('r-sep30', { startedAt: sep30End, baseUrl: 'https://api.example.com/sep' }),
            run('r-oct1-a', { startedAt: oct1Start, baseUrl: 'https://api.example.com/one' }),
            run('r-oct1-b', { startedAt: oct1End, baseUrl: 'https://other.service.io/one' }),
            run('r-oct2', { startedAt: oct2Start, baseUrl: 'https://api.example.com/two' }),
        ];
        render(<HistoryPage {...mountProps()} runs={runs} />);

        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } });

        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(2);
        expect(screen.getByText('api.example.com/one')).toBeInTheDocument();
        expect(screen.getByText('other.service.io/one')).toBeInTheDocument();

        // Combine with Target Base URL search
        fireEvent.change(screen.getByLabelText('Target Base URL'), { target: { value: 'api.example.com' } });
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(1);
        expect(screen.getByText('api.example.com/one')).toBeInTheDocument();

        // Clear all filters
        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(4);
    });

    it('supports quick date presets and toggling an active preset off', () => {
        const now = new Date();
        const todayRun = run('today', { startedAt: now.getTime(), baseUrl: 'https://today.example' });
        const oldRun = run('old', {
            startedAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 45).getTime(),
            baseUrl: 'https://old.example',
        });
        render(<HistoryPage {...mountProps()} runs={[todayRun, oldRun]} />);

        const todayBtn = screen.getByRole('button', { name: 'Today' });
        fireEvent.click(todayBtn);
        expect(todayBtn).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(1);
        expect(screen.getByText('today.example')).toBeInTheDocument();

        // Clicking active preset again clears the date filter
        fireEvent.click(todayBtn);
        expect(todayBtn).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(2);
    });

    it('validates inverted date ranges and shows an accessible alert without crashing', () => {
        render(<HistoryPage {...mountProps()} runs={[run('r1')]} />);

        const fromInput = screen.getByLabelText('From');
        const toInput = screen.getByLabelText('To');
        fireEvent.change(fromInput, { target: { value: '2026-10-10' } });
        fireEvent.change(toInput, { target: { value: '2026-10-05' } });

        expect(screen.getByRole('alert')).toHaveTextContent('Start date must be on or before end date.');
        expect(fromInput).toHaveAttribute('aria-invalid', 'true');
        expect(toInput).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Invalid date range')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(1);
    });

    it('shows a distinct filter empty state with Reset filters CTA when nothing matches', () => {
        render(<HistoryPage {...mountProps()} runs={[run('r1', { baseUrl: 'https://api.test' })]} />);

        fireEvent.change(screen.getByLabelText('Target Base URL'), { target: { value: 'nonexistent.domain' } });
        expect(screen.getByText('No scans match your filters')).toBeInTheDocument();
        expect(screen.queryByText('No scan history yet')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
        expect(screen.getByText('api.test')).toBeInTheDocument();
    });

    it('paginates long history lists and resets back to page 1 when filters change', () => {
        const runs = Array.from({ length: 30 }, (_, idx) =>
            run(`r-${idx}`, {
                startedAt: 1_700_000_000_000 - idx * 1000,
                baseUrl: idx < 28 ? `https://api-${idx}.example.com` : `https://special-${idx}.example.com`,
            })
        );
        render(<HistoryPage {...mountProps()} runs={runs} />);

        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(25);

        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(5);

        // Changing filter resets pagination back to page 1
        fireEvent.change(screen.getByLabelText('Target Base URL'), { target: { value: 'api-' } });
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(25);
    });

    it('initializes filters from URL query params and syncs updates back to the URL', () => {
        window.history.replaceState({}, '', '/?history_url=alpha.test&history_from=2026-10-01&history_to=2026-10-02');
        const runs = [
            run('r1', { startedAt: new Date(2026, 9, 1, 12, 0, 0).getTime(), baseUrl: 'https://alpha.test' }),
            run('r2', { startedAt: new Date(2026, 9, 1, 12, 0, 0).getTime(), baseUrl: 'https://beta.test' }),
        ];
        render(<HistoryPage {...mountProps()} runs={runs} />);

        expect((screen.getByLabelText('Target Base URL') as HTMLInputElement).value).toBe('alpha.test');
        expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-10-01');
        expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-10-02');
        expect(screen.getAllByRole('button', { name: 'Load Run' })).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        const params = new URLSearchParams(window.location.search);
        expect(params.has('history_url')).toBe(false);
        expect(params.has('history_from')).toBe(false);
        expect(params.has('history_to')).toBe(false);
    });

    it('queries server-side /api/scans when authenticated and supports cursor pagination for older matches', async () => {
        localStorage.setItem('swazz_token', 'tok-123');
        useAppStore.setState({ activeProject: { id: 'proj-1', name: 'Demo' } } as any);

        const fetchMock = vi.fn(async (url: string) => {
            const u = new URL(url, 'http://edge');
            if (!u.searchParams.get('cursor')) {
                return new Response(JSON.stringify({
                    scans: [{
                        id: 'srv-1',
                        project_id: 'proj-1',
                        target_url: 'https://archive.example.com/v1',
                        status: 'completed',
                        created_at: '2026-10-02 10:00:00',
                        completed_at: '2026-10-02 10:01:00',
                    }],
                    next_cursor: 'cur-2',
                }), { status: 200 });
            }
            return new Response(JSON.stringify({
                scans: [{
                    id: 'srv-2',
                    project_id: 'proj-1',
                    target_url: 'https://archive.example.com/v0',
                    status: 'completed',
                    created_at: '2026-10-01 10:00:00',
                    completed_at: '2026-10-01 10:01:00',
                }],
            }), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);

        const p = { ...mountProps(), runs: [run('local-1', { baseUrl: 'https://recent.example.com' })] };
        render(<HistoryPage {...p} />);

        fireEvent.change(screen.getByLabelText('Target Base URL'), { target: { value: 'archive.example.com' } });

        await waitFor(() => {
            expect(screen.getByText('archive.example.com/v1')).toBeInTheDocument();
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const firstUrl = new URL(fetchMock.mock.calls[0][0], 'http://edge');
        expect(firstUrl.searchParams.get('project_id')).toBe('proj-1');
        expect(firstUrl.searchParams.get('target_url')).toBe('archive.example.com');

        // Load older matching scans via cursor
        fireEvent.click(screen.getByRole('button', { name: 'Load older matches' }));
        await waitFor(() => {
            expect(screen.getByText('archive.example.com/v0')).toBeInTheDocument();
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const secondUrl = new URL(fetchMock.mock.calls[1][0], 'http://edge');
        expect(secondUrl.searchParams.get('cursor')).toBe('cur-2');

        // Clicking Load Run on a server-only scan passes the scan object fallback
        fireEvent.click(screen.getAllByRole('button', { name: 'Load Run' })[0]);
        expect(p.onLoadRun).toHaveBeenCalledWith('srv-1', expect.objectContaining({ id: 'srv-1', baseUrl: 'https://archive.example.com/v1' }));

        // Server-only scans without local cached results cannot be selected for Compare
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(2);
        for (const cb of checkboxes) {
            expect(cb).toBeDisabled();
            expect(cb).toHaveAttribute('title', 'Comparison requires locally synced scan results');
            expect(cb).toHaveAttribute('aria-label', expect.stringMatching(/Cannot compare archived scan/i));
        }
        expect(screen.queryByText(/scans selected for comparison/)).not.toBeInTheDocument();
    });
});
