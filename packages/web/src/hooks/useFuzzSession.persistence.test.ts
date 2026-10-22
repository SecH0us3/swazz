// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 *
 * A live scan's results against a real (fake-indexeddb) database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { renderHook, act } from '@testing-library/react';
import { useFuzzSession } from './useFuzzSession.js';
import { useAppStore } from '../store/appStore.js';
import { openDb, __resetDbPromise, dbGetRunResults } from './useDb.js';
import type { SwazzConfig } from '../types.js';

const config = { base_url: 'https://api.example.com', endpoints: [], settings: {} } as unknown as SwazzConfig;

describe('useFuzzSession persistence', () => {
    beforeEach(async () => {
        (globalThis as any).indexedDB = new IDBFactory();
        await __resetDbPromise();
    });
    afterEach(async () => {
        await __resetDbPromise();
    });

    // The run is saved once its last results are in IndexedDB, so History never shows a completed
    // run with rows still missing.
    it.each(['complete', 'error'] as const)('saves a run that ends (%s) after its results are written', async (ending) => {
        const db = await openDb();
        const tx = vi.spyOn(db, 'transaction');
        let rowsWhenSaved = -1;
        // The Inspector reloads when liveCount changes: its last change must find every row.
        useAppStore.setState({ liveCount: 0 });
        let rowsAtFinalCount = -1;
        const unsubscribe = useAppStore.subscribe((state, prev) => {
            if (state.liveCount === 25 && prev.liveCount !== 25) {
                void dbGetRunResults(db, `run-${ending}`).then(rows => { rowsAtFinalCount = rows.length; });
            }
        });
        // The run is saved once when it starts, and again when it ends.
        const saveRun = vi.fn(async (run: any) => {
            if (run.completedAt > 0) rowsWhenSaved = (await dbGetRunResults(db, run.id)).length;
        });
        const connectToExisting = vi.fn(async (_runId: string, onResult: any, onComplete: any, onError: any) => {
            for (let i = 0; i < 25; i++) onResult({ id: `r${i}`, endpoint: '/a', method: 'GET', status: 200, duration: 1 });
            if (ending === 'complete') onComplete({ totalRequests: 25 });
            else onError('runner lost');
        });
        const { result } = renderHook(() => useFuzzSession({
            config,
            updateConfig: vi.fn(),
            start: vi.fn(),
            connectToExisting,
            saveRun,
            getDb: () => db,
            showToast: vi.fn(),
        }));

        await act(async () => {
            await result.current.handleConnectToExisting(`run-${ending}`, Date.now() - 5000, 'https://api.example.com', 'manual', 'running');
        });

        await vi.waitFor(() => expect(rowsWhenSaved).toBe(25));
        await vi.waitFor(() => expect(rowsAtFinalCount).toBe(25));
        unsubscribe();
        expect(saveRun.mock.calls.filter(([run]) => run.completedAt > 0)).toHaveLength(1);
        // The 25 results went in one write, not one transaction each.
        expect(tx.mock.calls.filter(([, mode]) => mode === 'readwrite')).toHaveLength(1);
    });
});
