// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

// GET /api/scans pages newest first. The dashboard polls the first page; the first check of a
// project walks the pages, at most maxPages of them, so a new browser still gets its history.
export const SCANS_PAGE_SIZE = 200;
export const MAX_SCAN_PAGES = 25;

/** A project's scans as the edge lists them (rows of the scans table), newest first. */
export async function fetchProjectScans(token: string, projectId: string, opts: { allPages?: boolean } = {}): Promise<any[]> {
    const scans: any[] = [];
    let cursor: string | undefined;
    const maxPages = opts.allPages ? MAX_SCAN_PAGES : 1;
    for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({ project_id: projectId });
        if (opts.allPages) params.set('limit', String(SCANS_PAGE_SIZE));
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`${PROXY_URL}/api/scans?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`Failed to fetch scans (${res.status})`);
        const data = await res.json();
        scans.push(...(data.scans || []));
        if (typeof data.next_cursor !== 'string' || !data.next_cursor) break;
        cursor = data.next_cursor;
    }
    return scans;
}
