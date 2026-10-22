// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchProjectScans, MAX_SCAN_PAGES, SCANS_PAGE_SIZE } from './scansService';

function pages(count: number) {
    return vi.fn(async (url: string, _init?: RequestInit) => {
        const u = new URL(url, 'http://edge');
        const page = Number(u.searchParams.get('cursor') ?? '0');
        const body = { scans: [{ id: `s${page}` }], ...(page + 1 < count ? { next_cursor: String(page + 1) } : {}) };
        return new Response(JSON.stringify(body), { status: 200 });
    });
}

describe('fetchProjectScans', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads only the first page by default', async () => {
        const fetchMock = pages(3);
        vi.stubGlobal('fetch', fetchMock);
        expect(await fetchProjectScans('tok', 'p 1')).toEqual([{ id: 's0' }]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = new URL(fetchMock.mock.calls[0][0], 'http://edge');
        expect(url.searchParams.get('project_id')).toBe('p 1');
        expect(url.searchParams.has('cursor')).toBe(false);
        expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    });

    it('walks every page when asked', async () => {
        const fetchMock = pages(3);
        vi.stubGlobal('fetch', fetchMock);
        expect(await fetchProjectScans('tok', 'p', { allPages: true })).toEqual([{ id: 's0' }, { id: 's1' }, { id: 's2' }]);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(new URL(fetchMock.mock.calls[0][0], 'http://edge').searchParams.get('limit')).toBe(String(SCANS_PAGE_SIZE));
    });

    it('stops after the page cap', async () => {
        const fetchMock = pages(MAX_SCAN_PAGES + 10);
        vi.stubGlobal('fetch', fetchMock);
        expect(await fetchProjectScans('tok', 'p', { allPages: true })).toHaveLength(MAX_SCAN_PAGES);
        expect(fetchMock).toHaveBeenCalledTimes(MAX_SCAN_PAGES);
    });

    it('fails on an error response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
        await expect(fetchProjectScans('tok', 'p')).rejects.toThrow('403');
    });
});
