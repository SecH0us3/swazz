export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  COORDINATOR_DO: DurableObjectNamespace;
  JWT_SECRET: string;
  TURNSTILE_SECRET?: string;
  AUTH_ENABLED?: string; // 'true' | 'false'
  LIMIT_ANONYMOUS?: string; // 'true' | 'false'
  ALLOWED_ORIGINS?: string; // Comma-separated list of origins
  VERSION?: string;
}

