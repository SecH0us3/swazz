/**
 * useRunner — wraps FuzzRunner for React, sends requests via CORS proxy.
 */

import { useState, useCallback, useRef } from 'react';
import type { SwazzConfig, FuzzResult, RunStats } from '@swazz/core';
import { FuzzRunner } from '@swazz/core';

const MAX_RESULTS = 10_000;

export function useRunner(proxyUrl: string) {
    const [results, setResults] = useState<FuzzResult[]>([]);
    const [stats, setStats] = useState<RunStats | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const runnerRef = useRef<FuzzRunner | null>(null);

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
        (config: SwazzConfig, onResult?: (result: FuzzResult) => void, onComplete?: (stats: RunStats) => void, stripper?: (result: FuzzResult) => FuzzResult) => {
            if (runnerRef.current?.isRunning) return;

            setResults([]);
            setIsRunning(true);
            setIsPaused(false);

            const runner = new FuzzRunner(config, sendRequest);

            runner.onResult = (result: FuzzResult) => {
                onResult?.(result); // original full result for incremental saving
                const displayResult = stripper ? stripper(result) : result;
                setResults((prev) => {
                    const next = [...prev, displayResult];
                    return next.length > MAX_RESULTS ? next.slice(-MAX_RESULTS) : next;
                });
            };

            runner.onProgress = (s: RunStats) => {
                setStats({ ...s });
            };

            runner.onComplete = (s: RunStats) => {
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
        results,
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
