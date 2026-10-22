// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 *
 * Coverage for the lower-level exported IndexedDB helpers in useDb.ts
 * (openDb schema, dbStreamResult, dbGetRunResults, dbQueryResults pagination /
 * sort paths and empty/boundary cases). Uses fake-indexeddb with a fresh
 * factory per test so state never leaks.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
    openDb,
    __resetDbPromise,
    dbStreamResult,
    dbGetRunResults,
    dbQueryResults,
    createResultWriter,
} from './useDb.js';

function row(id: string, over: Record<string, any> = {}) {
    return { id, status: 200, duration: 10, timestamp: 1000, ...over } as any;
}

describe('useDb IndexedDB helpers', () => {
    beforeEach(async () => {
        (globalThis as any).indexedDB = new IDBFactory();
        await __resetDbPromise();
    });

    it('openDb creates the runs and results stores with the expected indexes', async () => {
        const db = await openDb();
        expect(Array.from(db.objectStoreNames)).toEqual(expect.arrayContaining(['runs', 'results']));
        const tx = db.transaction('results', 'readonly');
        const idx = Array.from(tx.objectStore('results').indexNames);
        expect(idx).toEqual(expect.arrayContaining(['runId', 'runId_status', 'runId_timestamp']));
    });

    it('openDb returns the same cached connection on repeated calls', async () => {
        const a = await openDb();
        const b = await openDb();
        expect(a).toBe(b);
    });

    it('dbStreamResult writes a row that dbGetRunResults reads back', async () => {
        const db = await openDb();
        await dbStreamResult(db, 'run-1', row('r1'));
        await dbStreamResult(db, 'run-1', row('r2'));
        const rows = await dbGetRunResults(db, 'run-1');
        expect(rows.map(r => r.id).sort()).toEqual(['r1', 'r2']);
    });

    it('dbGetRunResults returns an empty array for an unknown run', async () => {
        const db = await openDb();
        await dbStreamResult(db, 'run-1', row('r1'));
        expect(await dbGetRunResults(db, 'does-not-exist')).toEqual([]);
    });

    it('dbQueryResults returns an empty page and zero total for an empty run', async () => {
        const db = await openDb();
        const { rows, total } = await dbQueryResults(db, { runId: 'empty' });
        expect(rows).toEqual([]);
        expect(total).toBe(0);
    });

    it('dbQueryResults paginates with limit/offset while reporting the full total', async () => {
        const db = await openDb();
        for (let i = 0; i < 5; i++) {
            await dbStreamResult(db, 'run-p', row(`r${i}`, { timestamp: 1000 + i }));
        }
        const page = await dbQueryResults(db, { runId: 'run-p', limit: 2, offset: 1, sortKey: 'timestamp', sortDir: 'asc' });
        expect(page.total).toBe(5);
        expect(page.rows).toHaveLength(2);
    });

    it('dbQueryResults sorts in-memory for a non-timestamp sort key', async () => {
        const db = await openDb();
        await dbStreamResult(db, 'run-s', row('slow', { duration: 90, timestamp: 1 }));
        await dbStreamResult(db, 'run-s', row('fast', { duration: 10, timestamp: 2 }));
        const asc = await dbQueryResults(db, { runId: 'run-s', sortKey: 'duration', sortDir: 'asc' });
        expect(asc.rows.map(r => r.id)).toEqual(['fast', 'slow']);
        const desc = await dbQueryResults(db, { runId: 'run-s', sortKey: 'duration', sortDir: 'desc' });
        expect(desc.rows.map(r => r.id)).toEqual(['slow', 'fast']);
    });

    it('dbQueryResults filters by statusFilter (2xx, 4xx, 5xx)', async () => {
        const db = await openDb();
        await dbStreamResult(db, 'run-status', row('r200', { status: 200 }));
        await dbStreamResult(db, 'run-status', row('r404', { status: 404 }));
        await dbStreamResult(db, 'run-status', row('r500', { status: 500 }));
        await dbStreamResult(db, 'run-status', row('r0', { status: 0 }));

        const res2xx = await dbQueryResults(db, { runId: 'run-status', statusFilter: '2xx' });
        expect(res2xx.rows.map(r => r.id)).toEqual(['r200']);

        const res4xx = await dbQueryResults(db, { runId: 'run-status', statusFilter: '4xx' });
        expect(res4xx.rows.map(r => r.id)).toEqual(['r404']);

        const res5xx = await dbQueryResults(db, { runId: 'run-status', statusFilter: '5xx' });
        expect(res5xx.rows.map(r => r.id).sort()).toEqual(['r0', 'r500']);
    });

    it('dbQueryResults filters by identityFilter', async () => {
        const db = await openDb();
        await dbStreamResult(db, 'run-ident', row('rA1', { identity: undefined }));
        await dbStreamResult(db, 'run-ident', row('rA2', { identity: 'user a' }));
        await dbStreamResult(db, 'run-ident', row('rB', { identity: 'User B' }));

        const userA = await dbQueryResults(db, { runId: 'run-ident', identityFilter: 'User A' });
        expect(userA.rows.map(r => r.id).sort()).toEqual(['rA1', 'rA2']);

        const userB = await dbQueryResults(db, { runId: 'run-ident', identityFilter: 'User B' });
        expect(userB.rows.map(r => r.id)).toEqual(['rB']);
    });

    it('dbQueryResults filters by findingsOnly and heatmapFilter', async () => {
        const db = await openDb();
        await dbStreamResult(db, 'run-find', row('ok', { status: 200, method: 'GET', endpoint: '/api/v1', analyzerFindings: [] }));
        await dbStreamResult(db, 'run-find', row('has-finding', { status: 200, method: 'GET', endpoint: '/api/v1', analyzerFindings: [{ id: 'f1' }] }));
        await dbStreamResult(db, 'run-find', row('err-403', { status: 403, method: 'GET', endpoint: '/api/v1' }));
        await dbStreamResult(db, 'run-find', row('net-err', { status: 0, method: 'POST', endpoint: '/api/v1', error: 'ECONNREFUSED' }));
        await dbStreamResult(db, 'run-find', row('mcp-call', { status: 200, method: 'CALL', endpoint: 'mcp://tool/check' }));

        const findings = await dbQueryResults(db, { runId: 'run-find', findingsOnly: true });
        expect(findings.rows.map(r => r.id).sort()).toEqual(['err-403', 'has-finding', 'mcp-call', 'net-err']);

        const heatmap = await dbQueryResults(db, {
            runId: 'run-find',
            heatmapFilter: { method: 'POST', path: '/api/v1', status: 0 }
        });
        expect(heatmap.rows.map(r => r.id)).toEqual(['net-err']);
    });

    it('dbQueryResults searches by endpoint and profile keywords', async () => {
        const db = await openDb();
        await dbStreamResult(db, 'run-search', row('r1', { endpoint: '/api/auth/login', profile: 'SQLi' }));
        await dbStreamResult(db, 'run-search', row('r2', { endpoint: '/api/users', profile: 'XSS' }));
        await dbStreamResult(db, 'run-search', row('r3', { endpoint: '/api/health', profile: 'PING' }));

        const loginRes = await dbQueryResults(db, { runId: 'run-search', search: 'login' });
        expect(loginRes.rows.map(r => r.id)).toEqual(['r1']);

        const xssRes = await dbQueryResults(db, { runId: 'run-search', search: 'xss' });
        expect(xssRes.rows.map(r => r.id)).toEqual(['r2']);
    });

    describe('createResultWriter', () => {
        it('writes the rows of a burst in one transaction', async () => {
            const db = await openDb();
            const tx = vi.spyOn(db, 'transaction');
            const writer = createResultWriter(() => db, 'run-b');
            for (let i = 0; i < 50; i++) writer.add(row(`b${i}`, { timestamp: i }));
            expect(tx).not.toHaveBeenCalled();
            await writer.flush();
            expect(tx).toHaveBeenCalledTimes(1);
            expect(await dbGetRunResults(db, 'run-b')).toHaveLength(50);
        });

        it('writes once maxRows are waiting, without waiting for the timer', async () => {
            const db = await openDb();
            const tx = vi.spyOn(db, 'transaction');
            const writer = createResultWriter(() => db, 'run-m', { maxRows: 3, maxDelayMs: 60_000 });
            for (let i = 0; i < 7; i++) writer.add(row(`m${i}`));
            expect(tx).toHaveBeenCalledTimes(0); // queued behind the first batch, written in order
            await writer.flush();
            expect(tx).toHaveBeenCalledTimes(3); // 3 + 3 by size, the last 1 by flush
            expect(await dbGetRunResults(db, 'run-m')).toHaveLength(7);
        });

        it('writes what is waiting after maxDelayMs', async () => {
            const db = await openDb();
            const tx = vi.spyOn(db, 'transaction');
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            try {
                const writer = createResultWriter(() => db, 'run-t', { maxDelayMs: 50 });
                writer.add(row('t1'));
                vi.advanceTimersByTime(49);
                expect(tx).not.toHaveBeenCalled();
                vi.advanceTimersByTime(1);
            } finally {
                vi.useRealTimers();
            }
            await vi.waitFor(async () => expect(await dbGetRunResults(db, 'run-t')).toHaveLength(1));
        });

        it('keeps the other rows of a batch with one row that cannot be stored', async () => {
            const db = await openDb();
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const writer = createResultWriter(() => db, 'run-x');
            writer.add(row('ok1'));
            writer.add(row('bad', { payload: () => 'functions cannot be cloned' }));
            writer.add(row('ok2'));
            await writer.flush();
            expect((await dbGetRunResults(db, 'run-x')).map(r => r.id).sort()).toEqual(['ok1', 'ok2']);
            warn.mockRestore();
        });

        it('keeps writing after a batch fails', async () => {
            const db = await openDb();
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            let broken = true;
            const writer = createResultWriter(() => (broken ? ({ transaction: () => { throw new Error('quota'); } } as any) : db), 'run-f');
            writer.add(row('lost'));
            await writer.flush();
            expect(warn).toHaveBeenCalledWith('[swazz] IDB write error:', expect.any(Error));
            broken = false;
            writer.add(row('kept'));
            await writer.flush();
            expect((await dbGetRunResults(db, 'run-f')).map(r => r.id)).toEqual(['kept']);
            warn.mockRestore();
        });

        it('drops rows when there is no database, and flushes nothing twice', async () => {
            const writer = createResultWriter(() => null, 'run-n');
            writer.add(row('n1'));
            await expect(writer.flush()).resolves.toBeUndefined();
            await expect(writer.flush()).resolves.toBeUndefined();
        });
    });
});
