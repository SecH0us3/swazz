// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ScanRun } from './useDb.js';
import {
    isValidDateInput,
    formatLocalDateInput,
    getPresetRange,
    detectActivePreset,
    localDateStartMs,
    localDateEndMs,
    toAsciiLowerCase,
    matchesHistoryFilters,
    readHistoryFiltersFromUrl,
    writeHistoryFiltersToUrl,
    useHistoryFilters,
} from './useHistoryFilters.js';

function makeRun(over: Partial<ScanRun> = {}): ScanRun {
    return {
        id: 'r1',
        startedAt: new Date(2026, 9, 15, 12, 0, 0).getTime(),
        completedAt: new Date(2026, 9, 15, 12, 1, 0).getTime(),
        baseUrl: 'https://api.example.com/v1',
        stats: { statusCounts: { '200': 5 } } as any,
        ...over,
    };
}

describe('useHistoryFilters helpers', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/');
    });

    it('validates real Gregorian calendar dates strictly', () => {
        expect(isValidDateInput('2026-10-15')).toBe(true);
        expect(isValidDateInput('2024-02-29')).toBe(true);
        expect(isValidDateInput('2026-02-29')).toBe(false);
        expect(isValidDateInput('2026-04-31')).toBe(false);
        expect(isValidDateInput('2026-13-01')).toBe(false);
        expect(isValidDateInput('2026-1-5')).toBe(false);
        expect(isValidDateInput('not-a-date')).toBe(false);
    });

    it('computes and detects quick date presets relative to a reference date', () => {
        const ref = new Date(2026, 9, 20, 14, 30, 0); // 2026-10-20 local
        expect(formatLocalDateInput(ref)).toBe('2026-10-20');

        const today = getPresetRange('today', ref);
        expect(today).toEqual({ from: '2026-10-20', to: '2026-10-20' });
        expect(detectActivePreset(today.from, today.to, ref)).toBe('today');

        const last7 = getPresetRange('7d', ref);
        expect(last7).toEqual({ from: '2026-10-14', to: '2026-10-20' });
        expect(detectActivePreset(last7.from, last7.to, ref)).toBe('7d');

        const last30 = getPresetRange('30d', ref);
        expect(last30).toEqual({ from: '2026-09-21', to: '2026-10-20' });
        expect(detectActivePreset(last30.from, last30.to, ref)).toBe('30d');

        expect(detectActivePreset('2026-10-01', '2026-10-10', ref)).toBeNull();
    });

    it('matches Target Base URL with ASCII-only case folding matching SQLite LOWER() semantics', () => {
        const r = makeRun({ baseUrl: 'https://Staging.Example.com/100%_test\\v1?foo=bar' });
        expect(matchesHistoryFilters(r, { targetUrl: 'STAGING.EXAMPLE.COM', dateFrom: '', dateTo: '' })).toBe(true);
        expect(matchesHistoryFilters(r, { targetUrl: '  100%_test\\v1  ', dateFrom: '', dateTo: '' })).toBe(true);
        expect(matchesHistoryFilters(r, { targetUrl: 'other.example.com', dateFrom: '', dateTo: '' })).toBe(false);

        // Non-ASCII characters are preserved verbatim (matching SQLite LOWER/LIKE)
        expect(toAsciiLowerCase('ÄPI/ÜBER')).toBe('Äpi/Über');
        const upperNonAscii = makeRun({ baseUrl: 'https://ÄPI.example.com/v1' });
        const lowerNonAscii = makeRun({ baseUrl: 'https://äpi.example.com/v1' });
        expect(matchesHistoryFilters(upperNonAscii, { targetUrl: 'ÄPI', dateFrom: '', dateTo: '' })).toBe(true);
        expect(matchesHistoryFilters(upperNonAscii, { targetUrl: 'Äpi', dateFrom: '', dateTo: '' })).toBe(true);
        expect(matchesHistoryFilters(upperNonAscii, { targetUrl: 'äpi', dateFrom: '', dateTo: '' })).toBe(false);
        expect(matchesHistoryFilters(lowerNonAscii, { targetUrl: 'äPI', dateFrom: '', dateTo: '' })).toBe(true);
    });

    it('matches inclusive local day boundaries accurately', () => {
        const dayStart = localDateStartMs('2026-10-15')!;
        const dayEnd = localDateEndMs('2026-10-15')!;

        expect(matchesHistoryFilters(makeRun({ startedAt: dayStart - 1 }), { targetUrl: '', dateFrom: '2026-10-15', dateTo: '2026-10-15' })).toBe(false);
        expect(matchesHistoryFilters(makeRun({ startedAt: dayStart }), { targetUrl: '', dateFrom: '2026-10-15', dateTo: '2026-10-15' })).toBe(true);
        expect(matchesHistoryFilters(makeRun({ startedAt: dayEnd }), { targetUrl: '', dateFrom: '2026-10-15', dateTo: '2026-10-15' })).toBe(true);
        expect(matchesHistoryFilters(makeRun({ startedAt: dayEnd + 1 }), { targetUrl: '', dateFrom: '2026-10-15', dateTo: '2026-10-15' })).toBe(false);
    });

    it('reads and writes URL query parameters while preserving unrelated params and rejecting invalid dates', () => {
        window.history.replaceState({}, '', '/?keep=1&history_url=api.test&history_from=2026-10-01&history_to=2026-02-30');
        expect(readHistoryFiltersFromUrl()).toEqual({
            searchQuery: 'api.test',
            dateFrom: '2026-10-01',
            dateTo: '',
        });

        writeHistoryFiltersToUrl({ searchQuery: 'staging.test', dateFrom: '2026-10-02', dateTo: '2026-10-05' });
        const params = new URLSearchParams(window.location.search);
        expect(params.get('keep')).toBe('1');
        expect(params.get('history_url')).toBe('staging.test');
        expect(params.get('history_from')).toBe('2026-10-02');
        expect(params.get('history_to')).toBe('2026-10-05');

        writeHistoryFiltersToUrl({ searchQuery: '', dateFrom: '', dateTo: '' });
        const cleared = new URLSearchParams(window.location.search);
        expect(cleared.get('keep')).toBe('1');
        expect(cleared.has('history_url')).toBe(false);
        expect(cleared.has('history_from')).toBe(false);
        expect(cleared.has('history_to')).toBe(false);
    });
});

describe('useHistoryFilters hook regressions', () => {
    beforeEach(() => {
        window.history.replaceState({}, '', '/');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        window.history.replaceState({}, '', '/');
    });

    it('resets isLoadingMoreServer when filters change mid-load-more so subsequent loadMoreServerRuns calls succeed', async () => {
        let resolveFirstLoadMore: ((res: Response) => void) | undefined;
        const requestedUrls: string[] = [];

        const fetchMock = vi.fn((url: string, init?: RequestInit) => {
            requestedUrls.push(url);
            const u = new URL(url, 'http://edge');
            const cursor = u.searchParams.get('cursor');

            if (requestedUrls.length === 1) {
                return Promise.resolve(new Response(JSON.stringify({
                    scans: [{ id: 's1', project_id: 'p1', target_url: 'https://api.test/1', status: 'completed', created_at: '2026-10-05 10:00:00', completed_at: '2026-10-05 10:01:00' }],
                    next_cursor: 'cursor-1',
                }), { status: 200 }));
            }
            if (cursor === 'cursor-1') {
                // Keep pending until aborted by filter change
                return new Promise<Response>((resolve, reject) => {
                    resolveFirstLoadMore = resolve;
                    init?.signal?.addEventListener('abort', () => {
                        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                    });
                });
            }
            if (cursor === 'cursor-2') {
                return Promise.resolve(new Response(JSON.stringify({
                    scans: [{ id: 's3', project_id: 'p1', target_url: 'https://api.test/3', status: 'completed', created_at: '2026-10-03 10:00:00', completed_at: '2026-10-03 10:01:00' }],
                }), { status: 200 }));
            }
            // New filter initial page
            return Promise.resolve(new Response(JSON.stringify({
                scans: [{ id: 's2', project_id: 'p1', target_url: 'https://api.test/2', status: 'completed', created_at: '2026-10-04 10:00:00', completed_at: '2026-10-04 10:01:00' }],
                next_cursor: 'cursor-2',
            }), { status: 200 }));
        });
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() =>
            useHistoryFilters({
                runs: [],
                liveRunId: null,
                projectId: 'p1',
                token: 'tok',
            })
        );

        // Trigger initial filtered fetch
        act(() => {
            result.current.setDateFrom('2026-10-01');
        });

        await waitFor(() => expect(result.current.hasMoreServerResults).toBe(true));
        expect(result.current.filteredRuns.map(r => r.id)).toEqual(['s1']);

        // Start load-more and leave it pending
        let pendingLoadMore: Promise<void>;
        act(() => {
            pendingLoadMore = result.current.loadMoreServerRuns();
        });
        expect(result.current.isLoadingMoreServer).toBe(true);

        // Change date filter while load-more is still pending
        act(() => {
            result.current.setDateFrom('2026-10-02');
        });
        await act(async () => {
            await pendingLoadMore!;
        });

        // New first page resolves with cursor-2 and isLoadingMoreServer must not be stuck true
        await waitFor(() => expect(result.current.filteredRuns.map(r => r.id)).toEqual(['s2']));
        expect(result.current.isLoadingMoreServer).toBe(false);
        expect(result.current.hasMoreServerResults).toBe(true);

        // Calling loadMoreServerRuns() must send a new request with cursor-2
        await act(async () => {
            await result.current.loadMoreServerRuns();
        });

        expect(result.current.filteredRuns.map(r => r.id)).toEqual(['s2', 's3']);
        expect(requestedUrls.some(u => new URL(u, 'http://edge').searchParams.get('cursor') === 'cursor-2')).toBe(true);
        expect(resolveFirstLoadMore).toBeDefined();
    });

    it('keeps freshly completed non-CLI local runs in filtered results when matching and excludes non-matching ones', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({
            scans: [{
                id: 'srv-1',
                project_id: 'p1',
                target_url: 'https://api.example.com/old',
                status: 'completed',
                created_at: '2026-10-05 08:00:00',
                completed_at: '2026-10-05 08:01:00',
            }],
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const oct5Noon = new Date(2026, 9, 5, 12, 0, 0).getTime();
        const completedMatching = makeRun({
            id: 'scan-finished-match',
            startedAt: oct5Noon,
            completedAt: oct5Noon + 30_000,
            baseUrl: 'https://api.example.com/new',
        });
        const completedNonMatching = makeRun({
            id: 'scan-finished-other',
            startedAt: oct5Noon,
            completedAt: oct5Noon + 30_000,
            baseUrl: 'https://unrelated.service.io',
        });

        const { result, rerender } = renderHook(
            ({ runs, liveRunId }) =>
                useHistoryFilters({
                    runs,
                    liveRunId,
                    projectId: 'p1',
                    token: 'tok',
                }),
            {
                initialProps: {
                    runs: [
                        { ...completedMatching, completedAt: 0 },
                        completedNonMatching,
                    ],
                    liveRunId: 'scan-finished-match' as string | null,
                },
            }
        );

        act(() => {
            result.current.setDateFrom('2026-10-05');
            result.current.setSearchQuery('api.example.com');
        });

        await waitFor(() => expect(result.current.filteredRuns.some(r => r.id === 'srv-1')).toBe(true));
        expect(result.current.filteredRuns.map(r => r.id)).toContain('scan-finished-match');
        expect(result.current.filteredRuns.map(r => r.id)).not.toContain('scan-finished-other');

        // Scan completes (liveRunId becomes null, completedAt > 0) before serverRuns refetches:
        // matching completed non-CLI scan must stay visible!
        rerender({
            runs: [completedMatching, completedNonMatching],
            liveRunId: null,
        });

        expect(result.current.filteredRuns.map(r => r.id)).toEqual(['scan-finished-match', 'srv-1']);
        expect(result.current.filteredRuns.map(r => r.id)).not.toContain('scan-finished-other');
    });
});
