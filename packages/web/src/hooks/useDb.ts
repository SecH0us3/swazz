/**
 * useDb — lightweight IndexedDB hook for persisting scan history.
 *
 * DB: "swazz-db", v2
 *   stores:
 *   - "runs"    → ScanRun metadata,  keyPath: "id"
 *   - "results" → ResultSummary rows, keyPath: "id",
 *                 indexes: "runId", "runId_status", "runId_timestamp"
 *
 * Design: SSE events are written directly here without going through React state.
 * The React layer only holds counters/stats, never the full results array.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { RunStats } from '../types.js';
import { toSummary, type ResultSummary } from './useRunner.js';

// ─── Types ────────────────────────────────────────────────────

export interface ScanRun {
    id: string;
    startedAt: number;
    completedAt: number;
    baseUrl: string;
    stats: RunStats;
}

export interface QueryOptions {
    runId: string;
    statusFilter?: 'all' | '2xx' | '4xx' | '5xx';
    search?: string;
    sortKey?: 'timestamp' | 'duration';
    sortDir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
}

// ─── DB open ─────────────────────────────────────────────────

const DB_NAME = 'swazz-db';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            const oldVersion = e.oldVersion;

            if (!db.objectStoreNames.contains('runs')) {
                db.createObjectStore('runs', { keyPath: 'id' });
            }

            if (db.objectStoreNames.contains('results') && oldVersion < 2) {
                db.deleteObjectStore('results');
            }

            if (!db.objectStoreNames.contains('results')) {
                const store = db.createObjectStore('results', { keyPath: 'id' });
                store.createIndex('runId', 'runId', { unique: false });
                store.createIndex('runId_status', ['runId', 'status'], { unique: false });
                store.createIndex('runId_timestamp', ['runId', 'timestamp'], { unique: false });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            dbPromise = null;
            reject(req.error);
        };
    });
    return dbPromise;
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

/**
 * Write a single result row to IDB. Intended to be called per-SSE-event.
 * Opens a single-item transaction — fast and non-blocking.
 */
export async function dbStreamResult(db: IDBDatabase, runId: string, row: ResultSummary): Promise<void> {
    const tx = db.transaction('results', 'readwrite');
    tx.objectStore('results').put({ ...row, runId });
    return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

/**
 * Batch write results — used for history import and final flush.
 */
async function dbAppendResults(db: IDBDatabase, runId: string, rows: ResultSummary[]): Promise<void> {
    if (rows.length === 0) return;
    const tx = db.transaction('results', 'readwrite');
    const store = tx.objectStore('results');
    for (const r of rows) {
        store.put({ ...r, runId });
    }
    return new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Query results for a run with filtering/sorting. Uses IDB index + JS post-filter.
 * Returns a page of ResultSummary — does NOT load everything into memory.
 */
export async function dbQueryResults(db: IDBDatabase, opts: QueryOptions): Promise<{ rows: ResultSummary[]; total: number }> {
    const { runId, statusFilter = 'all', search = '', sortKey = 'timestamp', sortDir = 'desc', limit = 200, offset = 0 } = opts;

    const tx = db.transaction('results', 'readonly');
    const index = tx.objectStore('results').index('runId');
    const all = await promisify<(ResultSummary & { runId: string })[]>(
        index.getAll(runId) as IDBRequest<(ResultSummary & { runId: string })[]>
    );

    let list: ResultSummary[] = all.map(({ runId: _rid, ...r }) => r as ResultSummary);

    // Filter by status class
    if (statusFilter === '5xx') list = list.filter(r => r.status >= 500);
    else if (statusFilter === '4xx') list = list.filter(r => r.status >= 400 && r.status < 500);
    else if (statusFilter === '2xx') list = list.filter(r => r.status >= 200 && r.status < 300);

    // Search
    if (search) {
        const q = search.toLowerCase();
        list = list.filter(r => r.endpoint.toLowerCase().includes(q) || r.profile.toLowerCase().includes(q));
    }

    // Sort
    list.sort((a, b) => {
        const va = sortKey === 'timestamp' ? a.timestamp : a.duration;
        const vb = sortKey === 'timestamp' ? b.timestamp : b.duration;
        return sortDir === 'asc' ? va - vb : vb - va;
    });

    const total = list.length;
    return { rows: list.slice(offset, offset + limit), total };
}

export async function dbGetRunResults(db: IDBDatabase, runId: string): Promise<ResultSummary[]> {
    const { rows } = await dbQueryResults(db, { runId, limit: 100_000 });
    return rows;
}

async function dbDeleteRun(db: IDBDatabase, runId: string): Promise<void> {
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

    const tx2 = db.transaction('runs', 'readwrite');
    await promisify(tx2.objectStore('runs').delete(runId));
}

async function dbCountResults(db: IDBDatabase, runId: string): Promise<number> {
    const tx = db.transaction('results', 'readonly');
    const index = tx.objectStore('results').index('runId');
    return promisify<number>(index.count(runId) as IDBRequest<number>);
}

// ─── Hook ────────────────────────────────────────────────────

export function useDb() {
    const [db, setDb] = useState<IDBDatabase | null>(null);
    const [runs, setRuns] = useState<ScanRun[]>([]);
    const dbRef = useRef<IDBDatabase | null>(null);

    useEffect(() => {
        let mounted = true;
        openDb().then(async (database) => {
            if (!mounted) return;
            dbRef.current = database;
            setDb(database);
            const existing = await dbGetRuns(database);
            if (mounted) setRuns(existing);
        }).catch((err) => {
            console.error('[swazz] IndexedDB open failed:', err);
        });
        return () => { mounted = false; };
    }, []);

    /** Get the raw db handle synchronously (for SSE callbacks that shouldn't wait for state). */
    const getDb = useCallback((): IDBDatabase | null => dbRef.current, []);

    const saveRun = useCallback(async (run: ScanRun, rows?: ResultSummary[]) => {
        const database = dbRef.current;
        if (!database) return;
        await dbSaveRun(database, run);
        if (rows && rows.length > 0) {
            await dbAppendResults(database, run.id, rows);
        }
        setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
    }, []);

    const importCliReport = useCallback(async (data: any) => {
        const database = dbRef.current;
        if (!database) return;

        if (!data || data.tool !== 'swazz' || !Array.isArray(data.findings)) {
            throw new Error('Invalid Swazz CLI report format');
        }

        const runId = `cli-${Date.now()}`;
        const timestamp = new Date(data.timestamp).getTime() || Date.now();

        const endpointCounts: Record<string, Record<number, number>> = {};
        const profileCounts = { RANDOM: 0, BOUNDARY: 0, MALICIOUS: 0 };

        const rows = data.findings.map((f: any) => {
            const key = `${f.method} ${f.endpoint}`;
            if (!endpointCounts[key]) endpointCounts[key] = {};
            endpointCounts[key][f.status] = (endpointCounts[key][f.status] || 0) + 1;
            if (f.profile in profileCounts) profileCounts[f.profile as keyof typeof profileCounts]++;
            return toSummary({ ...f, retries: f.retries || 0 });
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
            progress: { completedEndpoints: 0, totalEndpoints: 0, currentEndpoint: '', currentProfile: '' },
        };

        let baseUrl = 'CLI Import';
        try {
            if (data.findings[0]?.resolvedPath) baseUrl = new URL(data.findings[0].resolvedPath).origin;
        } catch { /* */ }

        const run: ScanRun = {
            id: runId,
            startedAt: timestamp,
            completedAt: timestamp + (data.summary?.durationSeconds || 0) * 1000,
            baseUrl,
            stats,
        };

        await dbSaveRun(database, run);
        await dbAppendResults(database, run.id, rows);
        setRuns((prev) => [run, ...prev]);
        return { runId, run };
    }, []);

    const queryResults = useCallback(async (opts: QueryOptions): Promise<{ rows: ResultSummary[]; total: number }> => {
        const database = dbRef.current;
        if (!database) return { rows: [], total: 0 };
        return dbQueryResults(database, opts);
    }, []);

    const countResults = useCallback(async (runId: string): Promise<number> => {
        const database = dbRef.current;
        if (!database) return 0;
        return dbCountResults(database, runId);
    }, []);

    // Legacy compat: load all results for export/history
    const getRunResults = useCallback(async (runId: string): Promise<ResultSummary[]> => {
        const database = dbRef.current;
        if (!database) return [];
        return dbGetRunResults(database, runId);
    }, []);

    const deleteRun = useCallback(async (runId: string) => {
        const database = dbRef.current;
        if (!database) return;
        await dbDeleteRun(database, runId);
        setRuns((prev) => prev.filter((r) => r.id !== runId));
    }, []);

    return { db, runs, getDb, saveRun, importCliReport, queryResults, countResults, getRunResults, deleteRun };
}
