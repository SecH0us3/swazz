import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { useDb, __resetDbPromise, DB_NAME } from './useDb.js';

describe('useDb hook', () => {
    afterEach(async () => {
        await __resetDbPromise();
    });
    beforeEach(async () => {
        await __resetDbPromise();
        // Clear fake-indexeddb between tests
        const req = indexedDB.deleteDatabase(DB_NAME);
        await new Promise((resolve, reject) => {
            req.onsuccess = resolve;
            req.onerror = reject;
        });
    });

    it('initializes with empty runs', async () => {
        const { result } = renderHook(() => useDb());

        // Wait for the asynchronous initialize to happen
        await waitFor(() => {
            expect(result.current.db).not.toBeNull();
        });

        expect(result.current.runs).toEqual([]);
    });

    it('saves a run and retrieves it', async () => {
        const { result } = renderHook(() => useDb());

        await waitFor(() => {
            expect(result.current.db).not.toBeNull();
        });

        const mockRun = {
            id: 'run_123',
            startedAt: 1000,
            completedAt: 2000,
            baseUrl: 'http://test.com',
            stats: { elapsedTimeMs: 1000, statusCounts: { '200': 1 }, totalRequests: 1 } as any
        };
        const mockResults = [{ id: 'res_1', status: 200, duration: 10 }] as any;

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
            expect(result.current.db).not.toBeNull();
        });

        const mockRun = {
            id: 'run_to_delete',
            startedAt: 1000,
            completedAt: 2000,
            baseUrl: 'http://test.com',
            stats: {} as any
        };
        const mockResults = [{ id: 'res_2', status: 500, duration: 50 }] as any;

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

    it('queries results filtering by findingsOnly', async () => {
        const { result } = renderHook(() => useDb());

        await waitFor(() => {
            expect(result.current.db).not.toBeNull();
        });

        const mockRun = {
            id: 'run_findings',
            startedAt: 1000,
            completedAt: 2000,
            baseUrl: 'http://test.com',
            stats: {} as any
        };
        const mockResults = [
            { id: 'res_200_clean', status: 200, duration: 10, analyzerFindings: [] },
            { id: 'res_200_xss', status: 200, duration: 12, analyzerFindings: [{ ruleId: 'swazz/reflected-xss', level: 'error' }] },
            { id: 'res_500_sqli', status: 500, duration: 15, analyzerFindings: [] },
            { id: 'res_404_ignored', status: 404, duration: 8, analyzerFindings: [] }
        ] as any;

        await act(async () => {
            await result.current.saveRun(mockRun, mockResults);
        });

        let allResults: any = null;
        let findingsOnlyResults: any = null;

        await act(async () => {
            allResults = await result.current.queryResults({ runId: 'run_findings', limit: 10 });
            findingsOnlyResults = await result.current.queryResults({ runId: 'run_findings', limit: 10, findingsOnly: true });
        });

        expect(allResults.rows).toHaveLength(4);
        
        // Should return:
        // - res_200_xss (has analyzerFindings)
        // - res_500_sqli (status >= 500)
        // - res_404_ignored (HTTP 4xx error response)
        expect(findingsOnlyResults.rows).toHaveLength(3);
        const ids = findingsOnlyResults.rows.map((r: any) => r.id);
        expect(ids).toContain('res_200_xss');
        expect(ids).toContain('res_500_sqli');
        expect(ids).toContain('res_404_ignored');
    });

    it('updates triage status and retrieves all triaged results', async () => {
        const { result } = renderHook(() => useDb());

        await waitFor(() => {
            expect(result.current.db).not.toBeNull();
        });

        const mockRun = {
            id: 'run_triage_test',
            startedAt: 1000,
            completedAt: 2000,
            baseUrl: 'http://test.com',
            stats: {} as any
        };
        const mockResults = [
            { id: 'res_t1', status: 500, duration: 10 },
            { id: 'res_t2', status: 200, duration: 15 }
        ] as any;

        await act(async () => {
            await result.current.saveRun(mockRun, mockResults);
        });

        // Triage the first finding
        await act(async () => {
            await result.current.updateTriage('res_t1', 'false_positive');
        });

        // Verify the finding is triaged in DB query
        let retrieved: any = null;
        await act(async () => {
            retrieved = await result.current.getRunResults('run_triage_test');
        });
        const resT1 = retrieved.find((r: any) => r.id === 'res_t1');
        expect(resT1.triage).toBe('false_positive');

        // Verify getAllTriaged returns it
        let triagedList: any[] = [];
        await act(async () => {
            triagedList = await result.current.getAllTriaged();
        });
        expect(triagedList).toHaveLength(1);
        expect(triagedList[0].id).toBe('res_t1');
        expect(triagedList[0].triage).toBe('false_positive');

        // Triage the second finding to none/reset
        await act(async () => {
            await result.current.updateTriage('res_t1', 'none');
        });
        await act(async () => {
            triagedList = await result.current.getAllTriaged();
        });
        expect(triagedList).toHaveLength(0);
    });

    it('saves a run with triggerType and retrieves it', async () => {
        const { result } = renderHook(() => useDb());

        await waitFor(() => {
            expect(result.current.db).not.toBeNull();
        });

        const mockRun = {
            id: 'run_scheduled_123',
            startedAt: 1000,
            completedAt: 2000,
            baseUrl: 'http://test.com',
            stats: {} as any,
            triggerType: 'scheduled' as const
        };

        await act(async () => {
            await result.current.saveRun(mockRun);
        });

        await waitFor(() => {
            expect(result.current.runs).toHaveLength(1);
        });
        expect(result.current.runs[0].triggerType).toBe('scheduled');
    });
});
