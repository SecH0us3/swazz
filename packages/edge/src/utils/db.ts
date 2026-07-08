import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { Env } from '../env';
import { logWarn, logError } from '../../../common/logging/logger';

const getLogCtx = (env: Env, ctx?: any) => ctx?.env ? ctx : { env, executionCtx: ctx };
/**
 * Resolves the appropriate D1 database binding based on the environment and optional routing key.
 * If routingKey indicates shard-1 and env.DB_SHARD_1 is defined, it routes there.
 * Otherwise, it defaults to the primary database binding (env.DB).
 */
export function getDB(env: Env, routingKey?: string | number, ctx?: any): D1Database {
  let db: D1Database;
  if (routingKey && typeof routingKey === 'string' && routingKey.includes('shard-1')) {
    const shard1 = (env as any).DB_SHARD_1 as D1Database | undefined;
    if (shard1) {
      db = shard1;
    } else {
      db = env.DB;
    }
  } else {
    db = env.DB;
  }

  // Wrap the D1Database instance to monitor and record slow queries
  return wrapD1Database(db, env, ctx);
}

/**
 * Records execution time for D1 queries and logs / caches slow queries.
 */
export async function recordQueryTime(query: string, duration: number, env: Env, ctx?: any) {
  const threshold = (env as any).SLOW_QUERY_THRESHOLD_MS !== undefined
    ? Number((env as any).SLOW_QUERY_THRESHOLD_MS)
    : 200;

  if (duration >= threshold) {
    const timestamp = new Date().toISOString();
    const logData = {
      event: 'slow_query',
      query,
      duration,
      threshold,
      timestamp
    };

    // 1. Emit structured log line
    logWarn(getLogCtx(env, ctx), 'Database', `Slow query detected: ${query}`, logData);

    const recordPromise = (async () => {
      // 2. Expose to Analytics Engine if bound
      if ((env as any).ANALYTICS_ENGINE) {
        try {
          (env as any).ANALYTICS_ENGINE.writeDataPoint({
            blobs: [query, timestamp],
            doubles: [duration, threshold],
            indexes: ['slow_query']
          });
        } catch (err) {
          logError(getLogCtx(env, ctx), 'Database', 'Failed to write to Analytics Engine', { error: err });
        }
      }

      // 3. Cache slow query in KV
      if (env.SESSION_CACHE) {
        try {
          const kvKey = 'admin:slow-queries';
          const existingRaw = await env.SESSION_CACHE.get(kvKey);
          let records: any[] = [];
          if (existingRaw) {
            try {
              records = JSON.parse(existingRaw);
            } catch {
              records = [];
            }
          }
          records.unshift(logData);
          if (records.length > 100) {
            records = records.slice(0, 100);
          }
          await env.SESSION_CACHE.put(kvKey, JSON.stringify(records), { expirationTtl: 86400 });
        } catch (err) {
          logError(getLogCtx(env, ctx), 'Database', 'Failed to save slow query to KV', { error: err });
        }
      }
    })();

    const isTest = env.JWT_SECRET === 'test-secret';
    if (isTest) {
      await recordPromise;
    } else if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(recordPromise);
    } else if (ctx && typeof ctx.executionCtx?.waitUntil === 'function') {
      ctx.executionCtx.waitUntil(recordPromise);
    } else {
      await recordPromise;
    }
  }
}

function wrapD1Database(db: D1Database, env: Env, ctx?: any): D1Database {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === '__originalDb') {
        return target;
      }
      if (prop === 'prepare') {
        return (query: string) => {
          const stmt = target.prepare(query);
          return wrapD1PreparedStatement(stmt, query, env, ctx);
        };
      }
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const startTime = Date.now();
          const unwrappedStatements = statements.map(s => (s as any).__originalStmt || s);
          try {
            const res = await target.batch(unwrappedStatements);
            return res;
          } finally {
            try {
              const duration = Date.now() - startTime;
              const label = statements.map(s => (s as any).__query || 'unknown').join('; ');
              const timingPromise = recordQueryTime(`BATCH: ${label}`, duration, env, ctx);
              if (ctx && (typeof ctx.waitUntil === 'function' || typeof ctx.executionCtx?.waitUntil === 'function')) {
                // Non-blocking
              } else {
                await timingPromise;
              }
            } catch (err) {
              logError(getLogCtx(env, ctx), 'Database', 'Failed to record slow query for batch', { error: err });
            }
          }
        };
      }
      if (prop === 'exec') {
        return async (query: string) => {
          const startTime = Date.now();
          try {
            const res = await target.exec(query);
            return res;
          } finally {
            try {
              const duration = Date.now() - startTime;
              const timingPromise = recordQueryTime(query, duration, env, ctx);
              if (ctx && (typeof ctx.waitUntil === 'function' || typeof ctx.executionCtx?.waitUntil === 'function')) {
                // Non-blocking
              } else {
                await timingPromise;
              }
            } catch (err) {
              logError(getLogCtx(env, ctx), 'Database', 'Failed to record slow query for exec', { error: err });
            }
          }
        };
      }
      if (prop === 'dump') {
        return async () => {
          const startTime = Date.now();
          try {
            const res = await target.dump();
            return res;
          } finally {
            try {
              const duration = Date.now() - startTime;
              const timingPromise = recordQueryTime('DUMP DATABASE', duration, env, ctx);
              if (ctx && (typeof ctx.waitUntil === 'function' || typeof ctx.executionCtx?.waitUntil === 'function')) {
                // Non-blocking
              } else {
                await timingPromise;
              }
            } catch (err) {
              logError(getLogCtx(env, ctx), 'Database', 'Failed to record slow query for dump', { error: err });
            }
          }
        };
      }

      // Use target instead of receiver to prevent "Illegal invocation" errors on native host bindings
      const val = Reflect.get(target, prop, target);
      if (typeof val === 'function') {
        return val.bind(target);
      }
      return val;
    }
  });
}

function wrapD1PreparedStatement(stmt: D1PreparedStatement, query: string, env: Env, ctx?: any): D1PreparedStatement {
  return new Proxy(stmt, {
    get(target, prop, receiver) {
      if (prop === '__originalStmt') {
        return target;
      }
      if (prop === '__query') {
        return query;
      }
      if (prop === 'bind') {
        return (...values: any[]) => {
          const nextStmt = target.bind(...values);
          return wrapD1PreparedStatement(nextStmt, query, env, ctx);
        };
      }
      if (prop === 'first' || prop === 'run' || prop === 'all' || prop === 'raw') {
        return async (...args: any[]) => {
          const startTime = Date.now();
          try {
            const method = prop;
            const res = await (target as any)[method](...args);
            return res;
          } finally {
            try {
              const duration = Date.now() - startTime;
              const timingPromise = recordQueryTime(query, duration, env, ctx);
              if (ctx && (typeof ctx.waitUntil === 'function' || typeof ctx.executionCtx?.waitUntil === 'function')) {
                // Non-blocking
              } else {
                await timingPromise;
              }
            } catch (err) {
              logError(getLogCtx(env, ctx), 'Database', 'Failed to record slow query for statement execution', { error: err });
            }
          }
        };
      }

      // Use target instead of receiver to prevent "Illegal invocation" errors on native host bindings
      const val = Reflect.get(target, prop, target);
      if (typeof val === 'function') {
        return val.bind(target);
      }
      return val;
    }
  });
}
