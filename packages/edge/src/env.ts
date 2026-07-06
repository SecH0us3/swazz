import type { D1Database, R2Bucket, KVNamespace, DurableObjectNamespace, Queue } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  SESSION_CACHE?: KVNamespace;
  COORDINATOR_DO: DurableObjectNamespace;
  JWT_SECRET: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  AUTH_ENABLED?: string; // 'true' | 'false'
  LIMIT_ANONYMOUS?: string; // 'true' | 'false'
  ALLOWED_ORIGINS?: string; // Comma-separated list of origins
  VERSION?: string;
  ADMIN_SECRET?: string;
  SCAN_QUEUE: Queue<any>;
  FINDINGS_QUEUE: Queue<any>;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_REDIRECT_URI?: string;
  BETA_BYPASS_CODE?: string;
  BETA_MODE_ENABLED?: string;
  BETA_USER_LIMIT?: string;
}

