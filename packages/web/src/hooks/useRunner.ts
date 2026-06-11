import { useState, useCallback, useRef, useEffect } from 'react';
import type { RunStats, AnalysisFinding } from '../types.js';
import { useAppStore } from '../store/appStore.js';

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

export function previewPayload(value: any): string {
    return preview(value);
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
    triage?: 'false_positive' | 'ignored' | 'acknowledged' | 'none';
}

export function toSummary(r: any): ResultSummary {
    return {
        id: r.id,
        timestamp: r.timestamp,
        method: r.method,
        endpoint: r.endpoint,
        resolvedPath: r.resolvedPath,
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
        triage: r.triage,
    };
}

const PROGRESS_THROTTLE_MS = 300;

export function useRunner(proxyUrl: string) {
    const wsRef = useRef<WebSocket | null>(null);
    const runIdRef = useRef<string | null>(null);

    const sendRequest = useCallback(
        async (req: {
            url: string;
            method: string;
            headers: Record<string, string>;
            cookies: Record<string, string>;
            body: any;
        }) => {
            const res = await fetch(`${proxyUrl}/api/proxy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req),
            });
            return res.json() as Promise<{ status: number; body: any; headers?: Record<string, string>; duration: number }>;
        },
        [proxyUrl],
    );

    const start = useCallback(
        async (
            config: any,
            onResult: (rawResult: any) => void,
            onComplete: (stats: RunStats) => void,
        ) => {
            if (useAppStore.getState().isRunning) return;

            useAppStore.setState({ isRunning: true, isPaused: false });

            let runId = '';
            try {
                const configToSend = { ...config };
                // Go backend expects endpoints to be an object with include/exclude, not an array of objects
                if (Array.isArray(configToSend.endpoints)) {
                    const include = configToSend.endpoints.map((ep: any) => `${ep.method} ${ep.path}`);
                    configToSend.endpoints = {
                        include,
                        exclude: configToSend.disabled_endpoints || []
                    };
                }

                const res = await fetch(`${proxyUrl}/api/runs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ config: configToSend }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    useAppStore.setState({ isRunning: false });
                    throw new Error(err.error || 'Failed to start run');
                }
                const data = await res.json();
                runId = data.id;
                runIdRef.current = runId;
            } catch (err) {
                useAppStore.setState({ isRunning: false });
                throw err;
            }

            let lastProgressTime = 0;

            const wsUrl = proxyUrl.replace('http', 'ws');
            const ws = new WebSocket(`${wsUrl}/api/runs/${runId}/events`);
            wsRef.current = ws;

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    
                    if (msg.type === 'result') {
                        onResult(msg.data);
                    } else if (msg.type === 'progress') {
                        const now = Date.now();
                        if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
                            lastProgressTime = now;
                            useAppStore.setState({ stats: msg.data });
                        }
                    } else if (msg.type === 'complete') {
                        const finalStats = msg.data;
                        useAppStore.setState({ stats: finalStats, isRunning: false, isPaused: false });
                        ws.close();
                        wsRef.current = null;
                        onComplete(finalStats);
                    }
                } catch {
                    // ignore parse errors
                }
            };

            ws.onerror = () => {
                ws.close();
                wsRef.current = null;
                useAppStore.setState({ isRunning: false });
            };
        },
        [proxyUrl],
    );

    const stop = useCallback(async () => {
        try {
            if (runIdRef.current) {
                const res = await fetch(`${proxyUrl}/api/runs/${runIdRef.current}/stop`, { method: 'POST' });
                if (!res.ok) throw new Error('Failed to stop run');
            }
        } finally {
            wsRef.current?.close();
            wsRef.current = null;
            useAppStore.setState({ isRunning: false });
        }
    }, [proxyUrl]);

    const pause = useCallback(async () => {
        if (!runIdRef.current) return;
        const res = await fetch(`${proxyUrl}/api/runs/${runIdRef.current}/pause`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to pause');
        useAppStore.setState({ isPaused: true });
    }, [proxyUrl]);

    const resume = useCallback(async () => {
        if (!runIdRef.current) return;
        const res = await fetch(`${proxyUrl}/api/runs/${runIdRef.current}/resume`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to resume');
        useAppStore.setState({ isPaused: false });
    }, [proxyUrl]);

    useEffect(() => {
        return () => { wsRef.current?.close(); };
    }, []);

    return { start, stop, pause, resume, sendRequest };
}
