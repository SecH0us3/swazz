// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { D1Database, R2Bucket, KVNamespace, DurableObjectNamespace, Queue, AnalyticsEngineDataset } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  DB_SHARD_1?: D1Database;
  STORAGE: R2Bucket;
  SESSION_CACHE?: KVNamespace;
  COORDINATOR_DO: DurableObjectNamespace;
  ANALYTICS_ENGINE?: AnalyticsEngineDataset;
  SLOW_QUERY_THRESHOLD_MS?: string | number;
  JWT_SECRET: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  AUTH_ENABLED?: string; // 'true' | 'false'
  PASSWORD_AUTH_ENABLED?: string; // 'true' | 'false'
  LIMIT_ANONYMOUS?: string; // 'true' | 'false'
  ALLOWED_ORIGINS?: string; // Comma-separated list of origins
  VERSION?: string;
  ADMIN_SECRET?: string;
  SCAN_QUEUE: Queue<any>;
  FINDINGS_QUEUE: Queue<any>;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_REDIRECT_URI?: string;
  GITLAB_CLIENT_ID?: string;
  GITLAB_CLIENT_SECRET?: string;
  GITLAB_REDIRECT_URI?: string;
  BETA_BYPASS_CODE?: string;
  BETA_MODE_ENABLED?: string;
  BETA_USER_LIMIT?: string;
  SWAZZ_LICENSE_PUBKEY?: string;
  SWAZZ_LICENSE_PRIVKEY?: string;
  NODE_ENV?: string;
  ALLOW_PRIVATE_WEBHOOKS?: string;
  WAF_CHECKER_URL?: string;
  SEND_EMAIL?: SendEmailBinding;
  AI?: WorkersAIBinding;
}

export interface WorkersAIBinding {
  run(model: string, inputs: Record<string, any>): Promise<any>;
}

export interface SendEmailRecipient {
  email: string;
  name?: string;
}

export interface SendEmailMessage {
  from: string | SendEmailRecipient;
  to: string | string[] | SendEmailRecipient | SendEmailRecipient[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}

export interface SendEmailBinding {
  send(message: SendEmailMessage): Promise<void>;
}


// The Hono environment every route registrar and middleware shares. It must be one
// type: Hono's Env generic is invariant, so declaring `Hono<{ Bindings: Env }>` in some
// registrars and `Hono<{ Bindings: Env; Variables: ... }>` in others made them mutually
// unassignable. That mismatch is why src/index.ts carried a blanket @ts-nocheck.
// auditDetails is `unknown` rather than `any` because its only consumer
// (middleware/auditLog.ts) already narrows it with a typeof check before use.
export type AppEnv = {
  Bindings: Env;
  Variables: { auditDetails: unknown };
};
