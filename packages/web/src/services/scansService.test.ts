// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchScansPage, fetchOlderScans, MAX_SCAN_PAGES, SCANS_PAGE_SIZE } from './scansService';

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
