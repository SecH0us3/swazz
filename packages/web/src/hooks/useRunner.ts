/**
 * useRunner — wraps FuzzRunner for React, sends requests via CORS proxy.
 *
 * Memory strategy: only lightweight ResultSummary objects live in React state.
 * Full FuzzResult data (payload, responseBody) is never retained — the summary
 * carries a short payloadPreview string so the user can see what was sent.
 */

import { useState, useCallback, useRef } from 'react';
import type { SwazzConfig, FuzzResult, RunStats } from '@swazz/core';
import { FuzzRunner } from '@swazz/core';

// ─── Lightweight row for the list / detail view ─────────────

const VALUE_LIMIT = 80;

export interface ResultSummary {
    id: string;
    timestamp: number;
    method: string;
    endpoint: string;
    resolvedPath: string;
    status: number;
    profile: string;
    duration: number;
    retries: number;
    payloadPreview: string;   // JSON with long values truncated per-field
    responsePreview: string;  // error response body preview (4xx/5xx only)
    error?: string;
}

/** Recursively truncate long leaf values, preserving object structure. */
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
    return val; // numbers, booleans
}

export function previewPayload(value: any): string {
    return preview(value);
}

const RESPONSE_VALUE_LIMIT = 400;

/** Like truncateValues but with a larger per-field limit for responses. */
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
        // Plain text / HTML error — show more generously
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

export function toSummary(r: FuzzResult): ResultSummary {
    return {
        id: r.id,
        timestamp: r.timestamp,
        method: r.method,
        endpoint: r.endpoint,
        resolvedPath: r.resolvedPath,
        status: r.status,
        profile: r.profile,
        duration: r.duration,
        retries: r.retries || 0,
        payloadPreview: preview(r.payload),
        responsePreview: previewResponse(r.responseBody),
        error: r.error,
    };
}

// ─── Constants ──────────────────────────────────────────────

const FLUSH_INTERVAL_MS = 250;
const PROGRESS_THROTTLE_MS = 250;

// ─── Hook ───────────────────────────────────────────────────

export function useRunner(proxyUrl: string) {
    const [rows, setRows] = useState<ResultSummary[]>([]);
    const [stats, setStats] = useState<RunStats | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const runnerRef = useRef<FuzzRunner | null>(null);

    // Buffer for batching UI updates
    const rowBufferRef = useRef<ResultSummary[]>([]);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const sendRequest = useCallback(
        async (req: {
            url: string;
            method: string;
            headers: Record<string, string>;
            cookies: Record<string, string>;
            body: any;
        }) => {
            const res = await fetch(`${proxyUrl}/proxy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req),
            });
            return res.json() as Promise<{ status: number; body: any; duration: number }>;
        },
        [proxyUrl],
    );

    const start = useCallback(
        (config: SwazzConfig, onResult?: (result: FuzzResult) => void, onComplete?: (stats: RunStats) => void) => {
            if (runnerRef.current?.isRunning) return;

            setRows([]);
            setIsRunning(true);
            setIsPaused(false);
            rowBufferRef.current = [];

            const flushBuffer = () => {
                const buf = rowBufferRef.current;
                if (buf.length === 0) return;
                rowBufferRef.current = [];
                setRows((prev) => [...prev, ...buf]);
            };

            const runner = new FuzzRunner(config, sendRequest);

            runner.onResult = (result: FuzzResult) => {
                onResult?.(result);

                // Only a lightweight summary goes into the UI array
                rowBufferRef.current.push(toSummary(result));
                if (!flushTimerRef.current) {
                    flushTimerRef.current = setTimeout(() => {
                        flushTimerRef.current = null;
                        flushBuffer();
                    }, FLUSH_INTERVAL_MS);
                }
            };

            let lastProgressTime = 0;
            runner.onProgress = (s: RunStats) => {
                const now = Date.now();
                if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
                    lastProgressTime = now;
                    setStats({ ...s });
                }
            };

            runner.onComplete = (s: RunStats) => {
                if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                }
                flushBuffer();
                setStats({ ...s });
                setIsRunning(false);
                setIsPaused(false);
                runnerRef.current = null;
                onComplete?.(s);
            };

            runner.onError = (error: Error) => {
                console.error('[swazz] Runner error:', error);
            };

            runnerRef.current = runner;
            runner.start().catch(console.error);
        },
        [sendRequest],
    );

    const stop = useCallback(() => {
        runnerRef.current?.stop();
    }, []);

    const pause = useCallback(() => {
        runnerRef.current?.pause();
        setIsPaused(true);
    }, []);

    const resume = useCallback(() => {
        runnerRef.current?.resume();
        setIsPaused(false);
    }, []);

    return {
        rows,
        stats,
        isRunning,
        isPaused,
        start,
        stop,
        pause,
        resume,
        sendRequest,
    };
}
