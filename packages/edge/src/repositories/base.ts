import { Env } from '../env';
import { getDB } from '../utils/db';
import type { D1Database } from '@cloudflare/workers-types';

export abstract class BaseService {
  protected db: D1Database;

  constructor(protected env: Env) {
    this.db = getDB(env);
  }
}
