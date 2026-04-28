import { useState, useCallback, useRef, useEffect } from 'react';

// Lightweight types needed by the UI
export interface RunStats {
    totalRequests: number;
    totalPlanned: number;
    requestsPerSecond: number;
    statusCounts: Record<number, number>;
    profileCounts: Record<string, number>;
    endpointCounts: Record<string, Record<number, number>>;
    startTime: number;
    isRunning: boolean;
    progress: {
        completedEndpoints: number;
        totalEndpoints: number;
        currentEndpoint: string;
        currentProfile: string;
    };
}

export interface FuzzResult {
    id: string;
    endpoint: string;
    resolvedPath: string;
    method: string;
    profile: string;
    status: number;
    duration: number;
    payload: any;
    responseBody?: any;
    error?: string;
    timestamp: number;
    retries: number;
}

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
    payloadPreview: string;
    responsePreview: string;
    error?: string;
}

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

const FLUSH_INTERVAL_MS = 250;
const PROGRESS_THROTTLE_MS = 250;

export function useRunner(proxyUrl: string) {
    const [rows, setRows] = useState<ResultSummary[]>([]);
    const [stats, setStats] = useState<RunStats | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isPaused, setIsPaused] = useState(false);

    const eventSourceRef = useRef<EventSource | null>(null);
    const rowBufferRef = useRef<ResultSummary[]>([]);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Provide the sendRequest mock for manual interactions in UI
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
            return res.json() as Promise<{ status: number; body: any; duration: number }>;
        },
        [proxyUrl],
    );

    const start = useCallback(
        async (config: any, onResult?: (result: FuzzResult) => void, onComplete?: (stats: RunStats) => void) => {
            if (isRunning) return;

            setRows([]);
            setIsRunning(true);
            setIsPaused(false);
            rowBufferRef.current = [];

            // Start via API
            try {
                const res = await fetch(`${proxyUrl}/api/fuzz/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config),
                });
                
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    console.error("Failed to start run:", err);
                    setIsRunning(false);
                    throw new Error(err.error || "Failed to start run");
                }
            } catch (err) {
                console.error("Error starting run:", err);
                setIsRunning(false);
                throw err;
            }

            const flushBuffer = () => {
                const buf = rowBufferRef.current;
                if (buf.length === 0) return;
                rowBufferRef.current = [];
                setRows((prev) => [...prev, ...buf]);
            };

            let lastProgressTime = 0;

            // Connect SSE
            const es = new EventSource(`${proxyUrl}/api/fuzz/stream`);
            eventSourceRef.current = es;

            es.addEventListener('result', (e) => {
                const result = JSON.parse(e.data) as FuzzResult;
                onResult?.(result);

                rowBufferRef.current.push(toSummary(result));
                if (!flushTimerRef.current) {
                    flushTimerRef.current = setTimeout(() => {
                        flushTimerRef.current = null;
                        flushBuffer();
                    }, FLUSH_INTERVAL_MS);
                }
            });

            es.addEventListener('progress', (e) => {
                const now = Date.now();
                if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
                    lastProgressTime = now;
                    setStats(JSON.parse(e.data));
                }
            });

            es.addEventListener('complete', (e) => {
                const finalStats = JSON.parse(e.data);
                if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                }
                flushBuffer();
                setStats(finalStats);
                setIsRunning(false);
                setIsPaused(false);
                es.close();
                eventSourceRef.current = null;
                onComplete?.(finalStats);
            });

            es.onerror = (err) => {
                console.error("SSE error:", err);
                es.close();
            };
        },
        [proxyUrl, isRunning],
    );

    const stop = useCallback(() => {
        fetch(`${proxyUrl}/api/fuzz/stop`, { method: 'POST' }).catch(console.error);
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        setIsRunning(false);
    }, [proxyUrl]);

    const pause = useCallback(() => {
        fetch(`${proxyUrl}/api/fuzz/pause`, { method: 'POST' }).catch(console.error);
        setIsPaused(true);
    }, [proxyUrl]);

    const resume = useCallback(() => {
        fetch(`${proxyUrl}/api/fuzz/resume`, { method: 'POST' }).catch(console.error);
        setIsPaused(false);
    }, [proxyUrl]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
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
