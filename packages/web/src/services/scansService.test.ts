// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    fetchScansPage,
    fetchOlderScans,
    parseServerTimestamp,
    serverScanToScanRun,
    MAX_SCAN_PAGES,
    SCANS_PAGE_SIZE,
} from './scansService';

// count pages: page n is fetched with cursor n (none for the first) and leads to n+1.
function pages(count: number) {
    return vi.fn(async (url: string, _init?: RequestInit) => {
        const u = new URL(url, 'http://edge');
        const page = Number(u.searchParams.get('cursor') ?? '0');
        const body = { scans: [{ id: `s${page}` }], ...(page + 1 < count ? { next_cursor: String(page + 1) } : {}) };
        return new Response(JSON.stringify(body), { status: 200 });
    });
}

const urlOf = (fetchMock: ReturnType<typeof pages>, call: number) => new URL(fetchMock.mock.calls[call][0], 'http://edge');

describe('fetchScansPage', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads one page and says where the next starts', async () => {
        const fetchMock = pages(3);
        vi.stubGlobal('fetch', fetchMock);
        expect(await fetchScansPage('tok', 'p 1')).toEqual({ scans: [{ id: 's0' }], nextCursor: '1' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = urlOf(fetchMock, 0);
        expect(url.searchParams.get('project_id')).toBe('p 1');
        expect(url.searchParams.has('cursor')).toBe(false);
        expect(url.searchParams.has('active')).toBe(false);
        expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    });

    it('asks for the scans that have not ended', async () => {
        const fetchMock = pages(1);
        vi.stubGlobal('fetch', fetchMock);
        expect(await fetchScansPage('tok', 'p', { active: true })).toEqual({ scans: [{ id: 's0' }] });
        expect(urlOf(fetchMock, 0).searchParams.get('active')).toBe('1');
    });

    it('fails on an error response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
        await expect(fetchScansPage('tok', 'p')).rejects.toThrow('403');
    });

    it('passes from, to, trimmed targetUrl, and AbortSignal', async () => {
        const fetchMock = pages(1);
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();
        await fetchScansPage('tok', 'p1', {
            from: '2026-10-01T00:00:00.000Z',
            to: '2026-10-05T23:59:59.999Z',
            targetUrl: '  api.example.com  ',
            signal: controller.signal,
        });
        const url = urlOf(fetchMock, 0);
        expect(url.searchParams.get('from')).toBe('2026-10-01T00:00:00.000Z');
        expect(url.searchParams.get('to')).toBe('2026-10-05T23:59:59.999Z');
        expect(url.searchParams.get('target_url')).toBe('api.example.com');
        expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
    });
});

describe('parseServerTimestamp & serverScanToScanRun', () => {
    it('parses SQLite UTC timestamps and ISO-8601 strings', () => {
        expect(parseServerTimestamp('2026-10-01 10:00:00')).toBe(Date.UTC(2026, 9, 1, 10, 0, 0));
        expect(parseServerTimestamp('2026-10-01T10:00:00Z')).toBe(Date.UTC(2026, 9, 1, 10, 0, 0));
        expect(parseServerTimestamp('')).toBeNull();
        expect(parseServerTimestamp('not-a-date')).toBeNull();
        expect(parseServerTimestamp(null)).toBeNull();
    });

    it('converts server scan rows safely into ScanRun objects', () => {
        const run = serverScanToScanRun({
            id: 'scan-1',
            project_id: 'p1',
            target_url: 'https://api.example.com',
            status: 'failed',
            failure_reason: 'Timeout',
            created_at: '2026-10-01 10:00:00',
            completed_at: '2026-10-01 10:02:00',
            summary_stats: '{"totalRequests":42}',
            trigger_type: 'scheduled',
        });
        expect(run).toEqual({
            id: 'scan-1',
            projectId: 'p1',
            baseUrl: 'https://api.example.com',
            startedAt: Date.UTC(2026, 9, 1, 10, 0, 0),
            completedAt: Date.UTC(2026, 9, 1, 10, 2, 0),
            stats: { totalRequests: 42 },
            triggerType: 'scheduled',
            failureReason: 'Timeout',
        });

        const badStats = serverScanToScanRun({
            id: 'scan-2',
            status: 'running',
            summary_stats: '{bad json',
            created_at: '2026-10-01 10:00:00',
        });
        expect(badStats.stats).toBeNull();
        expect(badStats.completedAt).toBe(0);
    });
});

describe('fetchOlderScans', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('walks the pages after the cursor', async () => {
        const fetchMock = pages(4);
        vi.stubGlobal('fetch', fetchMock);
        expect(await fetchOlderScans('tok', 'p', '1')).toEqual({ scans: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], truncated: false });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(urlOf(fetchMock, 0).searchParams.get('cursor')).toBe('1');
        expect(urlOf(fetchMock, 0).searchParams.get('limit')).toBe(String(SCANS_PAGE_SIZE));
    });

    it('stops after the page cap and says the history goes on', async () => {
        const fetchMock = pages(MAX_SCAN_PAGES + 10);
        vi.stubGlobal('fetch', fetchMock);
        const { scans, truncated } = await fetchOlderScans('tok', 'p', '1');
        expect(scans).toHaveLength(MAX_SCAN_PAGES);
        expect(truncated).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(MAX_SCAN_PAGES);
    });
});
