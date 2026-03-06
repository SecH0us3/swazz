import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useDb } from './useDb.js';

describe('useDb hook', () => {
    beforeEach(() => {
        // Clear fake-indexeddb between tests
        indexedDB.deleteDatabase('swazz-db');
    });

    it('initializes with empty runs', async () => {
        const { result } = renderHook(() => useDb());

        // Wait for the asynchronous initialize to happen
        await waitFor(() => {
            expect(result.current.runs).toBeDefined();
        });

        expect(result.current.runs).toEqual([]);
    });

    it('saves a run and retrieves it', async () => {
        const { result } = renderHook(() => useDb());

        await waitFor(() => {
            expect(result.current.runs).toBeDefined();
        });

        const mockRun = {
            id: 'run_123',
            startedAt: 1000,
            completedAt: 2000,
            baseUrl: 'http://test.com',
            stats: { elapsedTimeMs: 1000, statusCounts: { '200': 1 }, totalRequests: 1 } as any
        };
        const mockResults = [{ status: 200, duration: 10 }] as any;

        await act(async () => {
            await result.current.saveRun(mockRun, mockResults);
        });

        await waitFor(() => {
            expect(result.current.runs).toHaveLength(1);
        });
        expect(result.current.runs[0]).toEqual(mockRun);

        let retrievedResults: any[] = [];
        await act(async () => {
            retrievedResults = await result.current.getRunResults('run_123');
        });

        expect(retrievedResults).toHaveLength(1);
        expect(retrievedResults[0].status).toBe(200);
    });

    it('deletes a run and its results', async () => {
        const { result } = renderHook(() => useDb());

        await waitFor(() => {
            expect(result.current.runs).toBeDefined();
        });

        const mockRun = {
            id: 'run_to_delete',
            startedAt: 1000,
            completedAt: 2000,
            baseUrl: 'http://test.com',
            stats: {} as any
        };
        const mockResults = [{ status: 500, duration: 50 }] as any;

        await act(async () => {
            await result.current.saveRun(mockRun, mockResults);
        });

        await waitFor(() => {
            expect(result.current.runs).toHaveLength(1);
        });

        await act(async () => {
            await result.current.deleteRun('run_to_delete');
        });

        await waitFor(() => {
            expect(result.current.runs).toHaveLength(0);
        });

        let retrievedResults: any[] = [];
        await act(async () => {
            retrievedResults = await result.current.getRunResults('run_to_delete');
        });
        expect(retrievedResults).toHaveLength(0);
    });
});
