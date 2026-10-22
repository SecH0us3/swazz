// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// The live event stream of a scan, as the dashboard understands it. Every message is classified
// here, including the shapes older coordinators send (a bare {"error": ...}), so that no failure
// can be silently ignored and leave the scan looking like it is still running.

import type { RunStats } from '../types.js';

/** Longest runner text shown in the dashboard (the coordinator already bounds it). */
const MAX_MESSAGE_LENGTH = 500;

export const UNKNOWN_FAILURE = 'The scan failed without an error message.';

export type RunStreamEvent =
    | { kind: 'queued' }
    | { kind: 'result'; data: any }
    | { kind: 'progress'; stats: RunStats }
    | { kind: 'complete'; stats: RunStats }
    | { kind: 'error'; message: string }
    | { kind: 'log'; level: 'info' | 'warning' | 'error'; message: string }
    | { kind: 'ignored' };

function text(value: unknown): string {
    if (typeof value !== 'string') return '';
    const line = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return line.length > MAX_MESSAGE_LENGTH ? `${line.slice(0, MAX_MESSAGE_LENGTH - 1)}…` : line;
}

function errorMessage(data: unknown): string {
    if (typeof data === 'string') return text(data);
    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        return text(d.message) || text(d.error);
    }
    return '';
}

function logLevel(level: unknown): 'info' | 'warning' | 'error' {
    const l = typeof level === 'string' ? level.toLowerCase() : '';
    if (l === 'error' || l === 'fatal') return 'error';
    if (l === 'warn' || l === 'warning') return 'warning';
    return 'info';
}

/** Classifies one message of the scan's event stream (already parsed from JSON). */
export function interpretRunMessage(msg: unknown): RunStreamEvent {
    if (!msg || typeof msg !== 'object') return { kind: 'ignored' };
    const m = msg as Record<string, any>;
    switch (m.type) {
        case 'queued':
            return { kind: 'queued' };
        case 'result':
            return { kind: 'result', data: m.data };
        case 'progress':
            return { kind: 'progress', stats: m.data };
        case 'complete':
            return { kind: 'complete', stats: m.data };
        case 'error':
            return { kind: 'error', message: errorMessage(m.data) || errorMessage(m) || UNKNOWN_FAILURE };
        case 'runner_log': {
            const message = text(m.data?.message);
            return message ? { kind: 'log', level: logLevel(m.data?.level), message } : { kind: 'ignored' };
        }
        case undefined:
            // A runner error forwarded by a coordinator that predates typed errors.
            if ('error' in m) return { kind: 'error', message: errorMessage(m) || UNKNOWN_FAILURE };
            return { kind: 'ignored' };
        default:
            return { kind: 'ignored' };
    }
}

function parseStats(raw: unknown): RunStats | null {
    if (raw && typeof raw === 'object') return raw as RunStats;
    if (typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as RunStats) : null;
    } catch {
        return null;
    }
}

export type ScanStatus =
    | { state: 'active' }
    | { state: 'completed'; stats: RunStats | null }
    | { state: 'failed'; reason: string }
    | { state: 'unknown' };

/**
 * The scan's status from the API, for when the live stream went quiet or dropped. 'unknown' when
 * it cannot be told (network error, no access): the caller keeps waiting rather than guessing.
 */
export async function fetchScanStatus(runId: string, baseUrl = ''): Promise<ScanStatus> {
    try {
        const headers: Record<string, string> = {};
        const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${baseUrl}/api/scans/${encodeURIComponent(runId)}`, { headers });
        if (!res.ok) return { state: 'unknown' };
        const scan = (await res.json())?.scan;
        switch (scan?.status) {
            case 'completed':
                return { state: 'completed', stats: parseStats(scan.summary_stats) };
            case 'failed':
                return { state: 'failed', reason: text(scan.failure_reason) || UNKNOWN_FAILURE };
            case 'queued':
            case 'dispatched':
            case 'paused':
                return { state: 'active' };
            default:
                return { state: 'unknown' };
        }
    } catch {
        return { state: 'unknown' };
    }
}

/**
 * The query that opens the scan's event stream: a one-time ticket (`?ticket=...`), or '' without
 * a session or when the API turns the session away (sign-in may be off there), so the stream is
 * tried without credentials as it always was. null if no answer could be had: try again later.
 * Browsers cannot set headers on a WebSocket, and the session token must not go in its URL:
 * URLs end up in proxy and Cloudflare logs. The ticket opens this scan's stream once, within 30s.
 */
export async function fetchStreamQuery(runId: string, baseUrl = ''): Promise<string | null> {
    try {
        const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
        if (!token) return '';
        const res = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(runId)}/stream-ticket`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) return '';
        if (!res.ok) return null;
        const ticket = (await res.json())?.ticket;
        return typeof ticket === 'string' && ticket ? `?ticket=${encodeURIComponent(ticket)}` : null;
    } catch {
        return null;
    }
}

/**
 * The warnings and errors in the scan's stored runner log: the live stream misses what the
 * runner said before the dashboard connected (an MCP server rejected at the very start).
 */
export async function fetchRunnerWarnings(runId: string, baseUrl = '', keep = 5): Promise<{ count: number; recent: string[] } | null> {
    try {
        const headers: Record<string, string> = {};
        const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${baseUrl}/api/scans/${encodeURIComponent(runId)}/runner-logs`, { headers });
        if (!res.ok) return null;
        const rows = (await res.json())?.logs;
        if (!Array.isArray(rows)) return null;
        const messages: string[] = [];
        for (const row of rows) {
            let entry: any;
            try {
                const parsed = typeof row?.payload === 'string' ? JSON.parse(row.payload) : row?.payload;
                entry = parsed?.data ?? parsed;
            } catch {
                continue;
            }
            const message = text(entry?.message);
            if (message && logLevel(entry?.level) !== 'info') messages.push(message);
        }
        return { count: messages.length, recent: messages.slice(-keep) };
    } catch {
        return null;
    }
}
