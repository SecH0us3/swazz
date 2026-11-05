// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

// GET /api/scans pages newest first. The dashboard polls the newest page and the scans that have
// not ended (active=1, so a paused scan behind many newer ones is still found); once per project
// it reads the older pages in the background, at most MAX_SCAN_PAGES of them.
export const SCANS_PAGE_SIZE = 200;
export const MAX_SCAN_PAGES = 25;

export interface ScansPage {
    /** Rows of the scans table, newest first. */
    scans: any[];
    /** Where the next page starts; absent on the last one. */
    nextCursor?: string;
}

/** One page of a project's scans, or with active its scans that have not ended. */
export async function fetchScansPage(
    token: string,
    projectId: string,
    opts: { limit?: number; cursor?: string; active?: boolean } = {},
): Promise<ScansPage> {
    const params = new URLSearchParams({ project_id: projectId });
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.active) params.set('active', '1');
    const res = await fetch(`${PROXY_URL}/api/scans?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Failed to fetch scans (${res.status})`);
    const data = await res.json();
    const nextCursor = typeof data.next_cursor === 'string' && data.next_cursor ? data.next_cursor : undefined;
    return { scans: Array.isArray(data.scans) ? data.scans : [], ...(nextCursor ? { nextCursor } : {}) };
}

/**
 * The scans older than a page, from its cursor on, at most maxPages pages. truncated says the
 * history goes on past what was read.
 */
export async function fetchOlderScans(
    token: string,
    projectId: string,
    cursor: string,
    maxPages: number = MAX_SCAN_PAGES,
): Promise<{ scans: any[]; truncated: boolean }> {
    const scans: any[] = [];
    let next: string | undefined = cursor;
    for (let page = 0; page < maxPages && next; page++) {
        const res = await fetchScansPage(token, projectId, { limit: SCANS_PAGE_SIZE, cursor: next });
        scans.push(...res.scans);
        next = res.nextCursor;
    }
    return { scans, truncated: !!next };
}
