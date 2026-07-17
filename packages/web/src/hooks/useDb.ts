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
import { useAppStore } from '../store/appStore.js';

// ─── Types ────────────────────────────────────────────────────

export interface ScanRun {
    id: string;
    startedAt: number;
    completedAt: number;
    baseUrl: string;
    stats: RunStats;
    projectId?: string;
    triggerType?: 'manual' | 'scheduled';
}

import type { HeatmapFilter } from '../components/Dashboard/Heatmap.js';

export interface QueryOptions {
    runId: string;
    statusFilter?: 'all' | '2xx' | '4xx' | '5xx';
    search?: string;
    sortKey?: 'timestamp' | 'duration';
    sortDir?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    findingsOnly?: boolean;
    identityFilter?: string;
    heatmapFilter?: HeatmapFilter | null;
}

// ─── DB open ─────────────────────────────────────────────────

export const DB_NAME = 'swazz-db';
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

/** Test only: reset the internal DB promise to allow re-opening with a clean state. */
export async function __resetDbPromise() {
    if (dbPromise) { const db = await dbPromise; db.close(); }
    dbPromise = null;
}

export function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            const transaction = (e.target as IDBOpenDBRequest).transaction!;
            const oldVersion = e.oldVersion;

            if (!db.objectStoreNames.contains('runs')) {
                db.createObjectStore('runs', { keyPath: 'id' });
            }

            if (db.objectStoreNames.contains('results') && oldVersion < 2) {
                db.deleteObjectStore('results');
            }

            let store: IDBObjectStore;
            if (!db.objectStoreNames.contains('results')) {
                store = db.createObjectStore('results', { keyPath: 'id' });
                store.createIndex('runId', 'runId', { unique: false });
                store.createIndex('runId_status', ['runId', 'status'], { unique: false });
                store.createIndex('runId_timestamp', ['runId', 'timestamp'], { unique: false });
            } else {
                store = transaction.objectStore('results');
            }

            if (oldVersion < 3) {
                if (!store.indexNames.contains('triage')) {
                    store.createIndex('triage', 'triage', { unique: false });
                }
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
    const {
        runId,
        statusFilter = 'all',
        search = '',
        sortKey = 'timestamp',
        sortDir = 'desc',
        limit = 200,
        offset = 0,
        identityFilter = 'all',
        findingsOnly = false,
        heatmapFilter = null,
    } = opts;

    const tx = db.transaction('results', 'readonly');
    const store = tx.objectStore('results');
    const runIdIndex = store.index('runId');
    const totalCount = await promisify<number>(runIdIndex.count(runId));

    // Fall back to in-memory sorting/filtering for small runs or duration sorting (no index)
    const useInMemory = sortKey !== 'timestamp' || totalCount < 2000;

    if (useInMemory) {
        const all = await promisify<(ResultSummary & { runId: string })[]>(
            runIdIndex.getAll(runId) as IDBRequest<(ResultSummary & { runId: string })[]>
        );
        let list: ResultSummary[] = all.map(({ runId: _rid, ...r }) => r as ResultSummary);

        // Filter by identity
        if (identityFilter && identityFilter !== 'all') {
            list = list.filter(r => {
                if (identityFilter === 'User A') {
                    return !r.identity || r.identity.toLowerCase() === 'user a';
                }
                return r.identity?.toLowerCase() === identityFilter.toLowerCase();
            });
        }

        // Filter by status class
        if (statusFilter === '5xx') list = list.filter(r => r.status >= 500 || r.status === 0);
        else if (statusFilter === '4xx') list = list.filter(r => r.status >= 400 && r.status < 500);
        else if (statusFilter === '2xx') list = list.filter(r => r.status >= 200 && r.status < 300);

        // Filter by findings
        if (findingsOnly) {
            list = list.filter(r => 
                (r.analyzerFindings && r.analyzerFindings.length > 0) || 
                r.status >= 500 || 
                (r.status === 0 && r.error) ||
                (r.status >= 400 && ![401, 403, 404, 405, 422, 429].includes(r.status))
            );
        }

        // Filter by heatmapFilter
        if (heatmapFilter) {
            list = list.filter(r =>
                r.method.toUpperCase() === heatmapFilter.method.toUpperCase() &&
                r.endpoint === heatmapFilter.path &&
                r.status === heatmapFilter.status
            );
        }

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

    // Cursor-based iteration for large runs sorted by timestamp
    const index = store.index('runId_timestamp');
    const range = IDBKeyRange.bound([runId, 0], [runId, Infinity]);
    const direction: IDBCursorDirection = sortDir === 'desc' ? 'prev' : 'next';

    const rows: ResultSummary[] = [];
    let matchedCount = 0;
    const hasFilters = search || statusFilter !== 'all' || identityFilter !== 'all' || findingsOnly || !!heatmapFilter;

    return new Promise((resolve, reject) => {
        const req = index.openCursor(range, direction);

        req.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) {
                resolve({ rows, total: matchedCount });
                return;
            }

            const r = cursor.value as ResultSummary;

            // Apply filters
            let matches = true;

            if (identityFilter && identityFilter !== 'all') {
                if (identityFilter === 'User A') {
                    matches = !r.identity || r.identity.toLowerCase() === 'user a';
                } else {
                    matches = r.identity?.toLowerCase() === identityFilter.toLowerCase();
                }
            }

            if (matches && statusFilter !== 'all') {
                if (statusFilter === '5xx') matches = r.status >= 500 || r.status === 0;
                else if (statusFilter === '4xx') matches = r.status >= 400 && r.status < 500;
                else if (statusFilter === '2xx') matches = r.status >= 200 && r.status < 300;
            }

            if (matches && findingsOnly) {
                matches = !!(
                    (r.analyzerFindings && r.analyzerFindings.length > 0) || 
                    r.status >= 500 || 
                    (r.status === 0 && r.error) ||
                    (r.status >= 400 && ![401, 403, 404, 405, 422, 429].includes(r.status))
                );
            }

            if (matches && heatmapFilter) {
                matches = r.method.toUpperCase() === heatmapFilter.method.toUpperCase() &&
                          r.endpoint === heatmapFilter.path &&
                          r.status === heatmapFilter.status;
            }

            if (matches && search) {
                const q = search.toLowerCase();
                matches = r.endpoint.toLowerCase().includes(q) || r.profile.toLowerCase().includes(q);
            }

            if (matches) {
                matchedCount++;
                if (matchedCount > offset && rows.length < limit) {
                    rows.push(r);
                }

                // If no filters are present, we can abort the cursor immediately when limit is satisfied.
                if (!hasFilters && rows.length >= limit) {
                    resolve({ rows, total: totalCount });
                    return;
                }

                // If filters are present, we can abort once we find the (limit + 1)-th match to prove there is a next page.
                if (rows.length >= limit && matchedCount > offset + limit) {
                    resolve({ rows, total: totalCount });
                    return;
                }
            }

            cursor.continue();
        };

        req.onerror = () => reject(req.error);
    });
}

export async function dbGetRunResults(db: IDBDatabase, runId: string): Promise<ResultSummary[]> {
    const { rows } = await dbQueryResults(db, { runId, limit: 100_000 });
    return rows;
}

async function dbDeleteRun(db: IDBDatabase, runId: string): Promise<void> {
    // Delete all results for this run and the run metadata in a single atomic transaction.
    // We use a cursor for results to avoid loading all keys into memory (O(1) memory vs O(N)).
    const tx = db.transaction(['results', 'runs'], 'readwrite');
    const resultsStore = tx.objectStore('results');
    const runsStore = tx.objectStore('runs');
    const index = resultsStore.index('runId');

    // Enqueue the deletion of run metadata
    runsStore.delete(runId);

    // Enqueue the deletion of all results via cursor
    await new Promise<void>((resolve, reject) => {
        const req = index.openKeyCursor(runId);
        req.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursor>).result;
            if (cursor) {
                resultsStore.delete(cursor.primaryKey);
                cursor.continue();
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        req.onerror = () => reject(req.error);
    });
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
    const activeProject = useAppStore(state => state.activeProject);

    useEffect(() => {
        let mounted = true;
        openDb().then(async (database) => {
            if (!mounted) return;
            dbRef.current = database;
            setDb(database);
            const existing = await dbGetRuns(database);
            if (mounted) setRuns(existing);
        }).catch((err: unknown) => {
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
            totalResponseBytes: data.summary?.totalResponseBytes || 0,
            maxResponseSize: data.summary?.maxResponseSize || 0,
            totalDurationMs: data.summary?.totalDurationMs || 0,
        };

        let baseUrl = 'CLI Import';
        try {
            if (data.findings[0]?.resolvedPath) baseUrl = new URL(data.findings[0].resolvedPath).origin;
        } catch { /* */ }

        const activeProject = useAppStore.getState().activeProject;
        const run: ScanRun = {
            id: runId,
            startedAt: timestamp,
            completedAt: timestamp + (data.summary?.durationSeconds || 0) * 1000,
            baseUrl,
            stats,
            projectId: activeProject ? activeProject.id : undefined,
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

    const updateTriage = useCallback(async (id: string, triage: 'false_positive' | 'ignored' | 'acknowledged' | 'none') => {
        const database = dbRef.current;
        if (!database) return;
        const tx = database.transaction('results', 'readwrite');
        const store = tx.objectStore('results');
        const row = await promisify<ResultSummary>(store.get(id) as IDBRequest<ResultSummary>);
        if (row) {
            row.triage = triage === 'none' ? undefined : triage;
            await promisify(store.put(row));
        }
        return new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }, []);

    const getAllTriaged = useCallback(async (): Promise<ResultSummary[]> => {
        const database = dbRef.current;
        if (!database) return [];
        const tx = database.transaction('results', 'readonly');
        const store = tx.objectStore('results');
        const index = store.index('triage');
        const triaged: ResultSummary[] = [];

        return new Promise<ResultSummary[]>((resolve, reject) => {
            const req = index.openCursor();
            req.onsuccess = (e) => {
                const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
                if (cursor) {
                    const row = cursor.value as ResultSummary;
                    if (row.triage && row.triage !== 'none') {
                        triaged.push(row);
                    }
                    cursor.continue();
                } else {
                    resolve(triaged);
                }
            };
            req.onerror = () => reject(req.error);
        });
    }, []);

    let token: string | null = null;
    try {
        token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
    } catch { /* ignore */ }

    const filteredRuns = runs.filter(run => {
        if (token) {
            return activeProject ? run.projectId === activeProject.id : false;
        }
        return true;
    });

    return { db, runs: filteredRuns, getDb, saveRun, importCliReport, queryResults, countResults, getRunResults, deleteRun, updateTriage, getAllTriaged };
}
