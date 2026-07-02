import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../env';

/**
 * Resolves the appropriate D1 database binding based on the environment and optional routing key.
 * If routingKey indicates shard-1 and env.DB_SHARD_1 is defined, it routes there.
 * Otherwise, it defaults to the primary database binding (env.DB).
 */
export function getDB(env: Env, routingKey?: string | number): D1Database {
  if (routingKey && typeof routingKey === 'string' && routingKey.includes('shard-1')) {
    const shard1 = (env as any).DB_SHARD_1 as D1Database | undefined;
    if (shard1) {
      return shard1;
    }
  }
  return env.DB;
}
