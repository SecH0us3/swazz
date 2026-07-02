import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../env';

/**
 * Resolves the appropriate D1 database binding based on the environment and optional routing key.
 * Today it always returns env.DB, but in the future it can route to env.DB_SHARD_1, etc.
 */
export function getDB(env: Env, routingKey?: string | number): D1Database {
  return env.DB;
}
