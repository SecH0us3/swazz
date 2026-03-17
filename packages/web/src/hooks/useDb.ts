/**
 * useDb — lightweight IndexedDB hook for persisting scan history.
 *
 * DB: "swazz-db", v1
 *   stores:
 *   - "runs"    → ScanRun metadata,  keyPath: "id"
 *   - "results" → FuzzResult objects, keyPath: "id", index: "runId"
 */

import { useEffect, useState, useCallback } from 'react';
import type { RunStats } from '@swazz/core';
import { toSummary, type ResultSummary } from './useRunner.js';

// ─── Types ────────────────────────────────────────────────────

export interface ScanRun {
    id: string;
    startedAt: number;
    completedAt: number;
    baseUrl: string;
    stats: RunStats;
}

// ─── DB open ─────────────────────────────────────────────────

const DB_NAME = 'swazz-db';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains('runs')) {
                db.createObjectStore('runs', { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains('results')) {
                const resultStore = db.createObjectStore('results', { keyPath: 'id' });
                resultStore.createIndex('runId', 'runId', { unique: false });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ─── Low-level helpers ────────────────────────────────────────

function promisify<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbSaveRun(db: IDBDatabase, run: ScanRun): Promise<void> {
    const tx = db.transaction('runs', 'readwrite');
    await promisify(tx.objectStore('runs').put(run));
}

async function dbGetRuns(db: IDBDatabase): Promise<ScanRun[]> {
    const tx = db.transaction('runs', 'readonly');
    const runs = await promisify<ScanRun[]>(tx.objectStore('runs').getAll() as IDBRequest<ScanRun[]>);
    return runs.sort((a, b) => b.startedAt - a.startedAt);
}

async function dbAppendResults(db: IDBDatabase, runId: string, rows: ResultSummary[]): Promise<void> {
    const tx = db.transaction('results', 'readwrite');
    const store = tx.objectStore('results');
    for (const r of rows) {
        store.put({ ...r, runId });
    }
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function dbGetRunResults(db: IDBDatabase, runId: string): Promise<ResultSummary[]> {
    const tx = db.transaction('results', 'readonly');
    const index = tx.objectStore('results').index('runId');
    const results = await promisify<(ResultSummary & { runId: string })[]>(
        index.getAll(runId) as IDBRequest<(ResultSummary & { runId: string })[]>,
    );
    return results.map(({ runId: _rid, ...r }) => r as ResultSummary);
}

async function dbDeleteRun(db: IDBDatabase, runId: string): Promise<void> {
    // Delete all results for this run
    const tx1 = db.transaction('results', 'readwrite');
    const index = tx1.objectStore('results').index('runId');
    const keys = await promisify<IDBValidKey[]>(index.getAllKeys(runId) as IDBRequest<IDBValidKey[]>);
    for (const key of keys) {
        tx1.objectStore('results').delete(key);
    }
    await new Promise<void>((resolve, reject) => {
        tx1.oncomplete = () => resolve();
        tx1.onerror = () => reject(tx1.error);
    });

    // Delete the run metadata
    const tx2 = db.transaction('runs', 'readwrite');
    await promisify(tx2.objectStore('runs').delete(runId));
}

// ─── Hook ────────────────────────────────────────────────────

export function useDb() {
    const [db, setDb] = useState<IDBDatabase | null>(null);
    const [runs, setRuns] = useState<ScanRun[]>([]);

    // Open DB on mount and load run list
    useEffect(() => {
        let mounted = true;
        openDb().then(async (database) => {
            if (!mounted) return;
            setDb(database);
            const existing = await dbGetRuns(database);
            if (mounted) setRuns(existing);
        }).catch((err) => {
            console.error('[swazz] IndexedDB open failed:', err);
        });
        return () => { mounted = false; };
    }, []);

    const saveRun = useCallback(async (run: ScanRun, rows: ResultSummary[]) => {
        if (!db) return;
        await dbSaveRun(db, run);
        await dbAppendResults(db, run.id, rows);
        setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
    }, [db]);

    const importCliReport = useCallback(async (data: any) => {
        if (!db) return;

        // Basic validation of CLI JSON format
        if (!data || data.tool !== 'swazz' || !Array.isArray(data.findings)) {
            throw new Error('Invalid Swazz CLI report format');
        }

        const runId = `cli-${Date.now()}`;
        const timestamp = new Date(data.timestamp).getTime() || Date.now();

        // Map CLI summary to ScanRun stats
        const endpointCounts: Record<string, Record<number, number>> = {};
        const profileCounts = { RANDOM: 0, BOUNDARY: 0, MALICIOUS: 0 };

        data.findings.forEach((f: any) => {
            const key = `${f.method} ${f.endpoint}`;
            if (!endpointCounts[key]) endpointCounts[key] = {};
            endpointCounts[key][f.status] = (endpointCounts[key][f.status] || 0) + 1;
            
            if (f.profile in profileCounts) {
                profileCounts[f.profile as keyof typeof profileCounts]++;
            }
        });

        const stats: RunStats = {
            totalRequests: data.summary?.totalRequests || data.findings.length,
            totalPlanned: data.summary?.totalRequests || data.findings.length,
            requestsPerSecond: 0,
            statusCounts: data.summary?.statusCounts || {},
            profileCounts,
            endpointCounts,
            startTime: timestamp,
            isRunning: false,
            progress: {
                completedEndpoints: 0,
                totalEndpoints: 0,
                currentEndpoint: '',
                currentProfile: '',
            },
        };

        let baseUrl = 'CLI Import';
        try {
            if (data.findings[0]?.resolvedPath) {
                baseUrl = new URL(data.findings[0].resolvedPath).origin;
            }
        } catch (e) {
            // Fallback if resolvedPath is not a valid absolute URL
        }

        const run: ScanRun = {
            id: runId,
            startedAt: timestamp,
            completedAt: timestamp + (data.summary?.durationSeconds || 0) * 1000,
            baseUrl,
            stats,
        };

        // Convert Findings to ResultSummary
        const rows = data.findings.map((f: any) => toSummary({
            ...f,
            retries: f.retries || 0,
        }));

        await dbSaveRun(db, run);
        await dbAppendResults(db, run.id, rows);
        setRuns((prev) => [run, ...prev]);
        
        return { runId, run };
    }, [db]);

    const getRunResults = useCallback(async (runId: string): Promise<ResultSummary[]> => {
        if (!db) return [];
        return dbGetRunResults(db, runId);
    }, [db]);

    const deleteRun = useCallback(async (runId: string) => {
        if (!db) return;
        await dbDeleteRun(db, runId);
        setRuns((prev) => prev.filter((r) => r.id !== runId));
    }, [db]);

    return { runs, saveRun, importCliReport, getRunResults, deleteRun };
}
