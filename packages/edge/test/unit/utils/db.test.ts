import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDB, recordQueryTime } from '../../../src/utils/db';
import { Env } from '../../../src/env';
import { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

const mockLogWarn = vi.fn();
const mockLogError = vi.fn();

vi.mock('../../../../common/logging/logger', () => ({
  logWarn: (...args: any[]) => mockLogWarn(...args),
  logError: (...args: any[]) => mockLogError(...args)
}));

describe('getDB Helper & Proxy Traps', () => {
  let mockDB: any;
  let mockShard1DB: any;
  let mockEnv: Env;
  let mockKV: any;
  let mockAnalytics: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDB = {
      prepare: vi.fn(),
      batch: vi.fn(),
      exec: vi.fn(),
      dump: vi.fn(),
      someProperty: 'some-value',
      someMethod: vi.fn().mockReturnValue('method-result')
    };

    mockShard1DB = {
      prepare: vi.fn()
    };

    mockKV = {
      get: vi.fn(),
      put: vi.fn()
    };

    mockAnalytics = {
      writeDataPoint: vi.fn()
    };

    mockEnv = {
      DB: mockDB,
      DB_SHARD_1: mockShard1DB,
      SESSION_CACHE: mockKV,
      SLOW_QUERY_THRESHOLD_MS: 0, // Set to 0 so all immediate queries trigger slow query flow
      JWT_SECRET: 'test-secret',
      ANALYTICS_ENGINE: mockAnalytics
    } as unknown as Env;
  });

  describe('Database Routing', () => {
    it('returns the default DB binding when no routingKey is provided', () => {
      const db = getDB(mockEnv);
      expect((db as any).__originalDb).toBe(mockDB);
    });

    it('routes to shard1 when routingKey contains shard-1', () => {
      const db = getDB(mockEnv, 'project-shard-1-uuid');
      expect((db as any).__originalDb).toBe(mockShard1DB);
    });

    it('falls back to default DB when shard-1 is routed but DB_SHARD_1 is undefined', () => {
      const envWithoutShard = { DB: mockDB } as unknown as Env;
      const db = getDB(envWithoutShard, 'project-shard-1-uuid');
      expect((db as any).__originalDb).toBe(mockDB);
    });
  });

  describe('D1Database Proxy Traps', () => {
    it('forwards normal properties and binds functions correctly', () => {
      const db = getDB(mockEnv);
      expect(db.someProperty).toBe('some-value');
      expect((db as any).someMethod()).toBe('method-result');
    });

    it('intercepts prepare and returns a wrapped statement', () => {
      const mockStmt = { bind: vi.fn() };
      mockDB.prepare.mockReturnValue(mockStmt);

      const db = getDB(mockEnv);
      const stmt = db.prepare('SELECT * FROM users');

      expect(mockDB.prepare).toHaveBeenCalledWith('SELECT * FROM users');
      expect((stmt as any).__originalStmt).toBe(mockStmt);
      expect((stmt as any).__query).toBe('SELECT * FROM users');
    });

    it('intercepts batch execution and records execution time', async () => {
      const mockRes = [{ results: [] }];
      mockDB.batch.mockResolvedValue(mockRes);

      const db = getDB(mockEnv);

      // Create fake wrapped statements
      const stmt1 = { __originalStmt: 'original-stmt-1', __query: 'SELECT A' };
      const stmt2 = { __originalStmt: 'original-stmt-2', __query: 'SELECT B' };

      const res = await db.batch([stmt1 as any, stmt2 as any]);

      expect(res).toBe(mockRes);
      expect(mockDB.batch).toHaveBeenCalledWith(['original-stmt-1', 'original-stmt-2']);
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.anything(),
        'Database',
        expect.stringContaining('Slow query detected: BATCH: SELECT A; SELECT B'),
        expect.any(Object)
      );
    });

    it('intercepts exec execution and records execution time', async () => {
      mockDB.exec.mockResolvedValue({ count: 1 });

      const db = getDB(mockEnv);
      await db.exec('INSERT INTO logs VALUES (1)');

      expect(mockDB.exec).toHaveBeenCalledWith('INSERT INTO logs VALUES (1)');
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.anything(),
        'Database',
        expect.stringContaining('Slow query detected: INSERT INTO logs VALUES (1)'),
        expect.any(Object)
      );
    });

    it('intercepts dump execution and records execution time', async () => {
      const mockBuffer = new ArrayBuffer(10);
      mockDB.dump.mockResolvedValue(mockBuffer);

      const db = getDB(mockEnv);
      const res = await db.dump();

      expect(res).toBe(mockBuffer);
      expect(mockDB.dump).toHaveBeenCalled();
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.anything(),
        'Database',
        expect.stringContaining('Slow query detected: DUMP DATABASE'),
        expect.any(Object)
      );
    });

    it('handles recordQueryTime failures inside exec/batch/dump gracefully', async () => {
      mockDB.exec.mockResolvedValue({ count: 1 });
      
      // Force KV to throw during recordQueryTime to trigger logError
      mockKV.get.mockRejectedValue(new Error('KV connection failure'));

      const db = getDB(mockEnv);
      await db.exec('SELECT 1');

      expect(mockLogError).toHaveBeenCalledWith(
        expect.anything(),
        'Database',
        'Failed to save slow query to KV',
        expect.any(Object)
      );
    });
  });

  describe('D1PreparedStatement Proxy Traps', () => {
    let mockStmt: any;

    beforeEach(() => {
      mockStmt = {
        bind: vi.fn(),
        first: vi.fn(),
        run: vi.fn(),
        all: vi.fn(),
        raw: vi.fn(),
        someProp: 'stmt-prop',
        someFunc: vi.fn().mockReturnValue('stmt-func-res')
      };
      mockDB.prepare.mockReturnValue(mockStmt);
    });

    it('forwards standard statement properties and binds functions correctly', () => {
      const db = getDB(mockEnv);
      const stmt = db.prepare('SELECT 1');

      expect((stmt as any).someProp).toBe('stmt-prop');
      expect((stmt as any).someFunc()).toBe('stmt-func-res');
    });

    it('intercepts bind and returns a wrapped statement', () => {
      const boundStmt = { first: vi.fn() };
      mockStmt.bind.mockReturnValue(boundStmt);

      const db = getDB(mockEnv);
      const stmt = db.prepare('SELECT 1');
      const bound = stmt.bind('arg1', 2);

      expect(mockStmt.bind).toHaveBeenCalledWith('arg1', 2);
      expect((bound as any).__originalStmt).toBe(boundStmt);
    });

    it('intercepts query execution methods and records slow queries', async () => {
      mockStmt.all.mockResolvedValue({ results: [] });

      const db = getDB(mockEnv);
      const stmt = db.prepare('SELECT * FROM users');
      await stmt.all();

      expect(mockStmt.all).toHaveBeenCalled();
      expect(mockLogWarn).toHaveBeenCalledWith(
        expect.anything(),
        'Database',
        expect.stringContaining('Slow query detected: SELECT * FROM users'),
        expect.any(Object)
      );
    });

    it('handles query timing record failures inside statement execution gracefully', async () => {
      mockStmt.first.mockResolvedValue({ id: 1 });
      mockKV.get.mockRejectedValue(new Error('KV failed'));

      const db = getDB(mockEnv);
      const stmt = db.prepare('SELECT 1');
      await stmt.first();

      expect(mockLogError).toHaveBeenCalledWith(
        expect.anything(),
        'Database',
        'Failed to save slow query to KV',
        expect.any(Object)
      );
    });
  });

  describe('recordQueryTime Logic', () => {
    it('skips recording if query time is below threshold', async () => {
      (mockEnv as any).SLOW_QUERY_THRESHOLD_MS = 200;
      await recordQueryTime('SELECT 1', 10, mockEnv);
      expect(mockLogWarn).not.toHaveBeenCalled();
    });

    it('emits warn log and writes to Analytics Engine and KV if above threshold', async () => {
      (mockEnv as any).SLOW_QUERY_THRESHOLD_MS = 50;
      mockKV.get.mockResolvedValue(null);

      await recordQueryTime('SELECT * FROM users', 100, mockEnv);

      expect(mockLogWarn).toHaveBeenCalled();
      expect(mockAnalytics.writeDataPoint).toHaveBeenCalledWith({
        blobs: ['SELECT * FROM users', expect.any(String)],
        doubles: [100, 50],
        indexes: ['slow_query']
      });

      expect(mockKV.put).toHaveBeenCalledWith(
        'admin:slow-queries',
        expect.stringContaining('SELECT * FROM users'),
        { expirationTtl: 86400 }
      );
    });

    it('handles Analytics Engine write failures gracefully', async () => {
      (mockEnv as any).SLOW_QUERY_THRESHOLD_MS = 50;
      mockAnalytics.writeDataPoint.mockImplementation(() => {
        throw new Error('Analytics failed');
      });

      await recordQueryTime('SELECT 1', 100, mockEnv);

      expect(mockLogError).toHaveBeenCalledWith(
        expect.anything(),
        'Database',
        'Failed to write to Analytics Engine',
        expect.any(Object)
      );
    });

    it('manages slow query KV cache limits correctly and handles malformed existing cache JSON', async () => {
      (mockEnv as any).SLOW_QUERY_THRESHOLD_MS = 50;
      // Return malformed JSON to trigger JSON.parse catch fallback
      mockKV.get.mockResolvedValue('malformed-json');

      await recordQueryTime('SELECT 1', 100, mockEnv);

      expect(mockKV.put).toHaveBeenCalledWith(
        'admin:slow-queries',
        expect.stringContaining('SELECT 1'),
        expect.any(Object)
      );
    });

    it('limits KV cache to 100 items by slicing oldest', async () => {
      (mockEnv as any).SLOW_QUERY_THRESHOLD_MS = 50;
      const manyRecords = Array.from({ length: 150 }, (_, i) => ({
        event: 'slow_query',
        query: `SELECT ${i}`,
        duration: 100,
        threshold: 50,
        timestamp: new Date().toISOString()
      }));

      mockKV.get.mockResolvedValue(JSON.stringify(manyRecords));

      await recordQueryTime('SELECT NEW', 100, mockEnv);

      expect(mockKV.put).toHaveBeenCalled();
      const putArg = mockKV.put.mock.calls[0][1];
      const parsedPut = JSON.parse(putArg);
      expect(parsedPut.length).toBe(100);
      expect(parsedPut[0].query).toBe('SELECT NEW');
    });

    it('respects different execution contexts for waitUntil scheduling', async () => {
      (mockEnv as any).SLOW_QUERY_THRESHOLD_MS = 50;
      const mockCtx1 = {
        waitUntil: vi.fn()
      };
      
      const mockCtx2 = {
        executionCtx: {
          waitUntil: vi.fn()
        }
      };

      // Set env.JWT_SECRET to production value so it doesn't await recordPromise directly
      (mockEnv as any).JWT_SECRET = 'prod-secret';

      await recordQueryTime('SELECT A', 100, mockEnv, mockCtx1);
      expect(mockCtx1.waitUntil).toHaveBeenCalled();

      await recordQueryTime('SELECT B', 100, mockEnv, mockCtx2);
      expect(mockCtx2.executionCtx.waitUntil).toHaveBeenCalled();
    });
  });
});
