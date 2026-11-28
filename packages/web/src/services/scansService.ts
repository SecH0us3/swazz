// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { ScanRun } from '../hooks/useDb.js';
import { UNKNOWN_FAILURE } from './runStream.js';

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

export interface FetchScansPageOptions {
    limit?: number;
    cursor?: string;
    active?: boolean;
    /** ISO-8601 date or UTC timestamp lower bound (inclusive). */
    from?: string;
    /** ISO-8601 date or UTC timestamp upper bound (inclusive). */
    to?: string;
    /** Case-insensitive substring filter matched against target_url. */
    targetUrl?: string;
    signal?: AbortSignal;
}

/**
 * Parses a server timestamp (SQLite CURRENT_TIMESTAMP "YYYY-MM-DD HH:MM:SS" in UTC, or ISO-8601)
 * into epoch milliseconds. Returns null when missing or unparseable.
 */
export function parseServerTimestamp(ts: unknown): number | null {
    if (typeof ts !== 'string') return null;
    const trimmed = ts.trim();
    if (!trimmed) return null;
    const normalized = trimmed.includes('T') || /[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed)
        ? trimmed
        : `${trimmed.replace(' ', 'T')}Z`;
    const ms = Date.parse(normalized);
    return Number.isNaN(ms) ? null : ms;
}

/** Converts a server scan row into the frontend ScanRun shape. */
export function serverScanToScanRun(s: any): ScanRun {
    const isCompletedOnServer = s.status === 'completed' || s.status === 'failed';
    const serverCompletedAt = parseServerTimestamp(s.completed_at) ?? 0;
    const startedAt = parseServerTimestamp(s.created_at) ?? Date.now();
    const failureReason = s.status === 'failed' ? (s.failure_reason || UNKNOWN_FAILURE) : undefined;
    let stats: any = null;
    if (typeof s.summary_stats === 'string' && s.summary_stats) {
        try {
            stats = JSON.parse(s.summary_stats);
        } catch {
            stats = null;
        }
    } else if (s.summary_stats && typeof s.summary_stats === 'object') {
        stats = s.summary_stats;
    }

    return {
        id: s.id,
        startedAt,
        completedAt: isCompletedOnServer ? (serverCompletedAt || Date.now()) : 0,
        baseUrl: s.target_url || '',
        stats,
        projectId: s.project_id,
        triggerType: s.trigger_type || 'manual',
        ...(failureReason ? { failureReason } : {}),
    };
}

/**
 * Reconciles a server scan row against a cached local IndexedDB ScanRun.
 * Returns the updated ScanRun to persist, or null when local state is already current.
 * Migrates previously cached runs whose startedAt/completedAt drifted from UTC parsing.
 */
export function reconcileServerScan(s: any, localRun: ScanRun | undefined): ScanRun | null {
    const isCompletedOnServer = s.status === 'completed' || s.status === 'failed';
    const serverStartedAt = parseServerTimestamp(s.created_at);
    const serverCompletedAt = parseServerTimestamp(s.completed_at);
    const failureReason = s.status === 'failed' ? (s.failure_reason || UNKNOWN_FAILURE) : undefined;

    if (!localRun) {
        return serverScanToScanRun(s);
    }

    const justCompleted = localRun.completedAt === 0 && isCompletedOnServer;
    const lacksReason = !!failureReason && localRun.failureReason !== failureReason;
    const startedAtDrifted = serverStartedAt !== null && localRun.startedAt !== serverStartedAt;
    const completedAtDrifted = isCompletedOnServer && serverCompletedAt !== null && localRun.completedAt !== serverCompletedAt;

    if (!justCompleted && !lacksReason && !startedAtDrifted && !completedAtDrifted) {
        return null;
    }

    if (justCompleted) {
        const fresh = serverScanToScanRun(s);
        return {
            ...fresh,
            stats: fresh.stats ?? localRun.stats,
        };
    }

    return {
        ...localRun,
        ...(serverStartedAt !== null ? { startedAt: serverStartedAt } : {}),
        ...(isCompletedOnServer && serverCompletedAt !== null ? { completedAt: serverCompletedAt } : {}),
        ...(failureReason ? { failureReason } : {}),
    };
}

/** One page of a project's scans, or with active its scans that have not ended. */
export async function fetchScansPage(
    token: string,
    projectId: string,
    opts: FetchScansPageOptions = {},
): Promise<ScansPage> {
    const params = new URLSearchParams({ project_id: projectId });
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.active) params.set('active', '1');
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (opts.targetUrl && opts.targetUrl.trim()) params.set('target_url', opts.targetUrl.trim());
    const res = await fetch(`${PROXY_URL}/api/scans?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        ...(opts.signal ? { signal: opts.signal } : {}),
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
