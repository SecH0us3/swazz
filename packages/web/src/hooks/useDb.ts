/**
 * useDb — lightweight IndexedDB hook for persisting scan history.
 *
 * DB: "swazz-db", v1
 *   stores:
 *   - "runs"    → ScanRun metadata,  keyPath: "id"
 *   - "results" → FuzzResult objects, keyPath: "id", index: "runId"
 */

import { useEffect, useState, useCallback } from 'react';
import type { FuzzResult, RunStats } from '@swazz/core';

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

async function dbAppendResults(db: IDBDatabase, runId: string, results: FuzzResult[]): Promise<void> {
    const tx = db.transaction('results', 'readwrite');
    const store = tx.objectStore('results');
    for (const r of results) {
        store.put({ ...r, runId });
    }
    await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function dbGetRunResults(db: IDBDatabase, runId: string): Promise<FuzzResult[]> {
    const tx = db.transaction('results', 'readonly');
    const index = tx.objectStore('results').index('runId');
    const results = await promisify<(FuzzResult & { runId: string })[]>(
        index.getAll(runId) as IDBRequest<(FuzzResult & { runId: string })[]>,
    );
    return results.map(({ runId: _rid, ...r }) => r as FuzzResult);
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

    const saveRun = useCallback(async (run: ScanRun, results: FuzzResult[]) => {
        if (!db) return;
        await dbSaveRun(db, run);
        await dbAppendResults(db, run.id, results);
        setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
    }, [db]);

    const getRunResults = useCallback(async (runId: string): Promise<FuzzResult[]> => {
        if (!db) return [];
        return dbGetRunResults(db, runId);
    }, [db]);

    const deleteRun = useCallback(async (runId: string) => {
        if (!db) return;
        await dbDeleteRun(db, runId);
        setRuns((prev) => prev.filter((r) => r.id !== runId));
    }, [db]);

    return { runs, saveRun, getRunResults, deleteRun };
}
