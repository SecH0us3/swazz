// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useState, useCallback, useRef, useEffect } from 'react';
import type { RunStats, AnalysisFinding } from '../types.js';
import { useAppStore, type ScanIssue } from '../store/appStore.js';
import { interpretRunMessage, fetchScanStatus, fetchRunnerWarnings } from '../services/runStream.js';
import { hintForRunnerMessage } from '../utils/runnerErrorHints.js';

const VALUE_LIMIT = 80;
const RESPONSE_VALUE_LIMIT = 400;

function truncateValues(val: any): any {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string') {
        if (val.length <= VALUE_LIMIT) return val;
        return val.slice(0, VALUE_LIMIT) + `… (${val.length - VALUE_LIMIT} chars)`;
    }
    if (Array.isArray(val)) {
        if (val.length <= 3) return val.map(truncateValues);
        return [...val.slice(0, 3).map(truncateValues), `… (${val.length - 3} more items)`];
    }
    if (typeof val === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) {
            out[k] = truncateValues(v);
        }
        return out;
    }
    return val;
}

function truncateResponseValues(val: any): any {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string') {
        if (val.length <= RESPONSE_VALUE_LIMIT) return val;
        return val.slice(0, RESPONSE_VALUE_LIMIT) + `… (${val.length - RESPONSE_VALUE_LIMIT} chars)`;
    }
    if (Array.isArray(val)) {
        if (val.length <= 5) return val.map(truncateResponseValues);
        return [...val.slice(0, 5).map(truncateResponseValues), `… (${val.length - 5} more items)`];
    }
    if (typeof val === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) {
            out[k] = truncateResponseValues(v);
        }
        return out;
    }
    return val;
}

export function previewResponse(value: any): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') {
        if (value.length <= 2000) return value;
        return value.slice(0, 2000) + `\n… (${value.length - 2000} chars more)`;
    }
    return JSON.stringify(truncateResponseValues(value), null, 2);
}

export function preview(value: any): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') {
        if (value.length <= VALUE_LIMIT) return value;
        return value.slice(0, VALUE_LIMIT) + `… (${value.length - VALUE_LIMIT} chars)`;
    }
    return JSON.stringify(truncateValues(value), null, 2);
}

// Minimal shape stored in React state — no payload data
export interface ResultSummary {
    id: string;
    timestamp: number;
    method: string;
    endpoint: string;
    resolvedPath: string;
    requestUri?: string;
    status: number;
    profile: string;
    duration: number;
    payloadSize: number;
    retries: number;
    payloadPreview: string;
    responsePreview: string;
    error?: string;
    responseSize: number;
    responseHeaders?: Record<string, string[]>;
    requestHeaders?: Record<string, string>;
    hasHeaderInjection?: boolean;
    analyzerFindings?: AnalysisFinding[];
    identity?: string;
    owaspCategory?: string[];
    owaspApiCategory?: string[];
    cweIds?: string[];
    triage?: 'false_positive' | 'ignored' | 'acknowledged' | 'none';
}

export function toSummary(r: any): ResultSummary {
    return {
        id: r.id,
        timestamp: r.timestamp,
        method: r.method,
        endpoint: r.endpoint,
        resolvedPath: r.resolvedPath,
        requestUri: r.requestUri,
        status: r.status,
        profile: r.profile,
        duration: r.duration,
        payloadSize: r.payloadSize || 0,
        retries: r.retries || 0,
        // Use server-generated previews if available (FuzzResultSSE), otherwise generate client-side
        payloadPreview: r.payloadPreview ?? preview(r.payload),
        responsePreview: r.responsePreview ?? previewResponse(r.responseBody),
        error: r.error,
        responseSize: r.responseSize || 0,
        responseHeaders: r.responseHeaders || {},
        requestHeaders: r.requestHeaders || {},
        hasHeaderInjection: !!r.hasHeaderInjection,
        analyzerFindings: r.analyzerFindings || [],
        identity: r.identity,
        owaspCategory: r.owaspCategory || [],
        owaspApiCategory: r.owaspApiCategory || [],
        cweIds: r.cweIds || [],
        triage: r.triage,
    };
}

const PROGRESS_THROTTLE_MS = 300;

/** A new scan starts without the previous one's issue, warnings or stall. */
const FRESH_RUN_STATE = { scanIssue: null, runWarnings: { count: 0, recent: [] as string[] }, runStalled: false };

/** With nothing from the scan for this long, the dashboard says so and checks its status. */
export const RUN_STALL_AFTER_MS = 90_000;
/** How often a quiet scan's status is checked. */
export const RUN_STATUS_CHECK_MS = 15_000;
/** Reconnects of the live stream before the dashboard only polls the scan's status. */
export const RUN_MAX_RECONNECTS = 5;
const RECENT_WARNINGS = 5;

export interface RunHandlers {
    onResult: (rawResult: any) => void;
    onComplete: (stats: RunStats) => void;
    /** The scan failed; message is for the user. */
    onError?: (message: string) => void;
}

function firstHint(messages: string[]) {
    for (const m of messages) {
        const hint = hintForRunnerMessage(m);
        if (hint) return hint;
    }
    return null;
}

/** What the dashboard shows about a scan that failed. */
export function failureIssue(message: string, warnings: string[]): ScanIssue {
    return { level: 'error', title: 'The scan failed', details: [message], hint: firstHint([message, ...warnings]) };
}

/** What the dashboard shows about a scan that completed with warnings, if it did. */
export function warningsIssue(count: number, recent: string[]): ScanIssue | null {
    if (count === 0) return null;
    return {
        level: 'warning',
        title: `The scan completed with ${count} warning${count === 1 ? '' : 's'}`,
        details: recent,
        hint: firstHint(recent),
    };
}

/**
 * Follows a scan's live stream until the scan ends, and makes sure the dashboard learns that it
 * ended however it does: a complete or error event, the stream dropping (it checks the scan's
 * status and reconnects), or the scan going quiet (it checks the status periodically). Returns a
 * function that stops following.
 */
export function followRun(runId: string, proxyUrl: string, handlers: RunHandlers, wsRef: { current: WebSocket | null }): () => void {
    let finished = false;
    let ws: WebSocket | null = null;
    let reconnects = 0;
    let lastActivity = Date.now();
    // Nothing received yet: the scan may have ended before the dashboard connected.
    let receivedAny = false;
    let lastProgressTime = 0;
    let lastStats: RunStats | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const end = () => {
        finished = true;
        clearInterval(statusTimer);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (wsRef.current === ws) wsRef.current = null;
        ws?.close();
        useAppStore.setState({ isRunning: false, isPaused: false, isQueued: false, runStalled: false });
    };

    const fail = (message: string) => {
        if (finished) return;
        end();
        useAppStore.setState({ scanIssue: failureIssue(message, useAppStore.getState().runWarnings.recent) });
        handlers.onError?.(message);
    };

    const complete = (stats: RunStats, issue?: ScanIssue) => {
        if (finished) return;
        end();
        const { count, recent } = useAppStore.getState().runWarnings;
        useAppStore.setState({ stats, scanIssue: issue ?? warningsIssue(count, recent) });
        handlers.onComplete(stats);
        if (!issue) void includeStoredWarnings(count, useAppStore.getState().scanIssue);
    };

    // The stored runner log also has what the runner said before the dashboard connected. It
    // replaces what was shown only if that is still on screen: not dismissed, no new scan since.
    const includeStoredWarnings = async (liveCount: number, shown: ScanIssue | null) => {
        const stored = await fetchRunnerWarnings(runId, proxyUrl, RECENT_WARNINGS);
        if (!stored || stored.count <= liveCount) return;
        const state = useAppStore.getState();
        if (state.scanIssue !== shown || state.isRunning) return;
        useAppStore.setState({ runWarnings: stored, scanIssue: warningsIssue(stored.count, stored.recent) });
    };

    /** Settles the scan from its status in the API; true if it has ended. */
    const settleFromStatus = async (): Promise<boolean> => {
        const status = await fetchScanStatus(runId, proxyUrl);
        if (finished) return true;
        if (status.state === 'failed') {
            fail(status.reason);
            return true;
        }
        if (status.state === 'completed') {
            // The scan's own final stats from the API; what the stream showed only if it has none.
            complete(status.stats ?? lastStats ?? (useAppStore.getState().stats as RunStats), {
                level: 'warning',
                title: 'The live connection to this scan was lost before it finished',
                details: ['The scan completed, but the dashboard may not have received all results. Open it from History to see them all.'],
                hint: null,
            });
            return true;
        }
        return false;
    };

    const onMessage = (raw: string) => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return;
        }
        lastActivity = Date.now();
        receivedAny = true;
        // The stream works again: the reconnect budget is for consecutive failures, not a lifetime.
        reconnects = 0;
        if (useAppStore.getState().runStalled) useAppStore.setState({ runStalled: false });
        const event = interpretRunMessage(parsed);
        switch (event.kind) {
            case 'queued':
                useAppStore.setState({ isQueued: true });
                break;
            case 'result':
                useAppStore.setState({ isQueued: false });
                handlers.onResult(event.data);
                break;
            case 'progress': {
                lastStats = event.stats;
                useAppStore.setState({ isQueued: false });
                const now = Date.now();
                if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
                    lastProgressTime = now;
                    useAppStore.setState({ stats: event.stats });
                }
                break;
            }
            case 'complete':
                complete(event.stats);
                break;
            case 'error':
                fail(event.message);
                break;
            case 'log':
                if (event.level !== 'info') {
                    const { count, recent } = useAppStore.getState().runWarnings;
                    useAppStore.setState({ runWarnings: { count: count + 1, recent: [...recent, event.message].slice(-RECENT_WARNINGS) } });
                }
                break;
        }
    };

    const connect = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = proxyUrl ? proxyUrl.replace(/^http/, 'ws') : `${protocol}//${host}`;
        const wsToken = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
        const socket = new WebSocket(`${wsUrl}/api/runs/${runId}/events${wsToken ? `?token=${encodeURIComponent(wsToken)}` : ''}`);
        ws = socket;
        wsRef.current = socket;
        socket.onmessage = (e) => onMessage(e.data);
        socket.onopen = () => {
            if (!receivedAny) void settleFromStatus();
        };
        socket.onerror = () => socket.close();
        socket.onclose = () => {
            if (finished || ws !== socket) return;
            void onDrop();
        };
    };

    // The stream dropped before the scan ended: it may have ended meanwhile, or keep running.
    const onDrop = async () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (await settleFromStatus()) return;
        if (reconnects >= RUN_MAX_RECONNECTS) {
            useAppStore.setState({ runStalled: true });
            return;
        }
        reconnects++;
        reconnectTimer = setTimeout(() => {
            if (!finished) connect();
        }, 1000 * reconnects);
    };

    const statusTimer = setInterval(() => {
        if (finished) return;
        const { isQueued, isPaused } = useAppStore.getState();
        const quiet = Date.now() - lastActivity >= RUN_STALL_AFTER_MS;
        // A queued or paused scan is quiet by design; it is still checked, without the warning.
        if (quiet && !isQueued && !isPaused && !useAppStore.getState().runStalled) {
            useAppStore.setState({ runStalled: true });
        }
        if (quiet || !receivedAny || !ws || ws.readyState === WebSocket.CLOSED) void settleFromStatus();
    }, RUN_STATUS_CHECK_MS);

    connect();
    return () => {
        if (finished) return;
        finished = true;
        clearInterval(statusTimer);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (wsRef.current === ws) wsRef.current = null;
        ws?.close();
    };
}

export function useRunner(proxyUrl: string) {
    const wsRef = useRef<WebSocket | null>(null);
    const runIdRef = useRef<string | null>(null);
    const stopFollowingRef = useRef<(() => void) | null>(null);

    const follow = useCallback((runId: string, handlers: RunHandlers) => {
        stopFollowingRef.current?.();
        stopFollowingRef.current = followRun(runId, proxyUrl, handlers, wsRef);
    }, [proxyUrl]);

    const sendRequest = useCallback(
        async (req: {
            url: string;
            method: string;
            headers: Record<string, string>;
            cookies: Record<string, string>;
            body: any;
        }) => {
            const csrfToken = useAppStore.getState().csrfToken;
            const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (csrfToken) {
                requestHeaders['X-CSRF-Token'] = csrfToken;
            }
            const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
            if (token) {
                requestHeaders['Authorization'] = `Bearer ${token}`;
            }
            const res = await fetch(`${proxyUrl}/api/proxy`, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(req),
            });
            const data = await res.json().catch(() => ({ error: res.statusText || `HTTP ${res.status}` }));
            if (!res.ok) {
                const err: any = new Error(data.error || `Proxy error: ${res.status}`);
                err.status = res.status;
                throw err;
            }
            return data as { status: number; body: any; headers?: Record<string, string>; duration: number };
        },
        [proxyUrl],
    );

    const start = useCallback(
        async (
            config: any,
            onResult: (rawResult: any) => void,
            onComplete: (stats: RunStats) => void,
            clientRunId?: string,
            onError?: (message: string) => void,
        ) => {
            if (useAppStore.getState().isRunning) return;

            useAppStore.setState({ isRunning: true, isPaused: false, isQueued: false, ...FRESH_RUN_STATE });

            let runId = '';
            try {
                const configToSend = { ...config };
                if (Array.isArray(config.endpoints)) {
                    configToSend.endpoint_definitions = config.endpoints;
                }
                // Go backend expects endpoints to be an object with include/exclude, not an array of objects
                if (Array.isArray(configToSend.endpoints)) {
                    const include = configToSend.endpoints.map((ep: any) => `${ep.method} ${ep.path}`);
                    configToSend.endpoints = {
                        include,
                        exclude: configToSend.disabled_endpoints || []
                    };
                }

                const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
                const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
                if (token) {
                    requestHeaders['Authorization'] = `Bearer ${token}`;
                }
                const csrfToken = useAppStore.getState().csrfToken;
                if (csrfToken) {
                    requestHeaders['X-CSRF-Token'] = csrfToken;
                }

                // Extract projectId from config — keep agent config clean, send at top level
                const { projectId, ...agentConfig } = configToSend;

                const res = await fetch(`${proxyUrl}/api/runs`, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify({ config: agentConfig, projectId: projectId ?? '', runId: clientRunId }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    useAppStore.setState({ isRunning: false, isQueued: false });
                    throw new Error(err.error || 'Failed to start run');
                }
                const data = await res.json();
                runId = data.id;
                runIdRef.current = runId;
            } catch (err) {
                useAppStore.setState({ isRunning: false, isQueued: false });
                throw err;
            }

            follow(runId, { onResult, onComplete, onError });
        },
        [proxyUrl, follow],
    );

    const stop = useCallback(async () => {
        if (!runIdRef.current) return;
        try {
            const headers: Record<string, string> = {};
            const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const csrfToken = useAppStore.getState().csrfToken;
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

            const res = await fetch(`${proxyUrl}/api/runs/${runIdRef.current}/stop`, { 
                method: 'POST',
                headers
            });
            if (!res.ok) throw new Error('Failed to stop run');
        } catch (err) {
            console.error(err);
            throw err;
        } finally {
            stopFollowingRef.current?.();
            stopFollowingRef.current = null;
            wsRef.current?.close();
            wsRef.current = null;
            useAppStore.setState({ isRunning: false, isPaused: false, isQueued: false, runStalled: false });
        }
    }, [proxyUrl]);

    const pause = useCallback(async () => {
        if (!runIdRef.current) return;
        const headers: Record<string, string> = {};
        const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const csrfToken = useAppStore.getState().csrfToken;
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        const res = await fetch(`${proxyUrl}/api/runs/${runIdRef.current}/pause`, { 
            method: 'POST',
            headers
        });
        if (!res.ok) throw new Error('Failed to pause');
        useAppStore.setState({ isPaused: true });
    }, [proxyUrl]);

    const resume = useCallback(async () => {
        if (!runIdRef.current) return;
        const headers: Record<string, string> = {};
        const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const csrfToken = useAppStore.getState().csrfToken;
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        const res = await fetch(`${proxyUrl}/api/runs/${runIdRef.current}/resume`, { 
            method: 'POST',
            headers
        });
        if (!res.ok) throw new Error('Failed to resume');
        useAppStore.setState({ isPaused: false });
    }, [proxyUrl]);

    const connectToExisting = useCallback(
        async (
            runId: string,
            onResult: (rawResult: any) => void,
            onComplete: (stats: RunStats) => void,
            onError?: (message: string) => void,
        ) => {
            if (useAppStore.getState().isRunning) return;

            useAppStore.setState({ isRunning: true, isPaused: false, isQueued: false, ...FRESH_RUN_STATE });
            runIdRef.current = runId;
            follow(runId, { onResult, onComplete, onError });
        },
        [follow]
    );

    useEffect(() => {
        return () => {
            stopFollowingRef.current?.();
            wsRef.current?.close();
        };
    }, []);

    return { start, stop, pause, resume, sendRequest, connectToExisting };
}
