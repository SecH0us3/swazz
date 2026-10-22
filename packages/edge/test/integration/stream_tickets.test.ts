// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// The dashboard opens a scan's event stream with a one-time ticket, never its session token: a
// ticket opens one run's stream for one user, once, within 30 seconds, against the real D1 schema.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Env } from '../../src/env';
import { RunnersRepository } from '../../src/repositories/runners';
import { CleanupRepository } from '../../src/repositories/cleanup';
import { RunnersService, STREAM_TICKET_TTL_SECONDS, MAX_LIVE_STREAM_TICKETS } from '../../src/services/runners';
import { hashApiKey, deletionCache } from '../../src/utils/auth';
import { sign } from 'hono/jwt';
import { applyMigrations } from '../utils/migrations';

const baseEnv = rawEnv as unknown as Env;

describe('event stream tickets', () => {
  let forwarded: string[];
  let service: RunnersService;
  let env: Env;
  let app: { fetch: (req: Request, env: Env) => Promise<Response> };
  let runA: string;
  let runB: string;
  const owner = 'stream-owner';

  beforeAll(async () => {
    await applyMigrations(baseEnv);
    app = (await import('../../src/index')).default as any;
  });

  beforeEach(async () => {
    forwarded = [];
    env = {
      ...baseEnv,
      AUTH_ENABLED: 'true',
      SESSION_CACHE: undefined,
      COORDINATOR_DO: {
        idFromName: () => 'id',
        get: () => ({
          fetch: async (req: Request) => {
            forwarded.push(req.url);
            return new Response('connected');
          },
        }),
      },
    } as unknown as Env;
    service = new RunnersService(env, new RunnersRepository(env), { checkPermission: vi.fn() } as any);

    runA = crypto.randomUUID();
    runB = crypto.randomUUID();
    for (const id of [runA, runB]) {
      await baseEnv.DB.prepare(
        "INSERT INTO scans (id, project_id, target_url, profile, status, user_id) VALUES (?, '', 'http://t', 'default', 'queued', ?)"
      ).bind(id, owner).run();
    }
  });

  // Through the worker: the auth middleware redeems the ticket, the route opens the stream.
  const open = (runId: string, ticket?: string, upgrade = 'websocket') =>
    app.fetch(new Request(`http://localhost/api/runs/${runId}/events?ticket=${ticket}&token=leaked`, { headers: { Upgrade: upgrade } }), env);

  it('opens the stream as the user it was issued to, once', async () => {
    const { ticket, expiresIn } = await service.issueStreamTicket(runA, owner);
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresIn).toBe(STREAM_TICKET_TTL_SECONDS);

    expect(await (await open(runA, ticket)).text()).toBe('connected');
    expect((await open(runA, ticket)).status).toBe(401);
  });

  it('stores only the hash of a ticket', async () => {
    const { ticket } = await service.issueStreamTicket(runA, owner);
    const plain = await baseEnv.DB.prepare('SELECT 1 FROM ws_tickets WHERE ticket_hash = ?').bind(ticket).first();
    const hashed = await baseEnv.DB.prepare('SELECT user_id, run_id FROM ws_tickets WHERE ticket_hash = ?').bind(await hashApiKey(ticket)).first();
    expect(plain).toBeNull();
    expect(hashed).toEqual({ user_id: owner, run_id: runA });
  });

  it('does not pass the ticket or a token on to the coordinator', async () => {
    const { ticket } = await service.issueStreamTicket(runA, owner);
    await open(runA, ticket);
    const url = new URL(forwarded[0]);
    expect(url.pathname).toBe('/connect-client');
    expect(url.searchParams.get('runId')).toBe(runA);
    expect(url.searchParams.has('ticket')).toBe(false);
    expect(url.searchParams.has('token')).toBe(false);
  });

  it('opens only the run it was issued for, and is spent by trying another', async () => {
    const { ticket } = await service.issueStreamTicket(runA, owner);
    expect((await open(runB, ticket)).status).toBe(401);
    expect((await open(runA, ticket)).status).toBe(401);
    expect(forwarded).toEqual([]);
  });

  it('refuses an expired ticket', async () => {
    const { ticket } = await service.issueStreamTicket(runA, owner);
    await baseEnv.DB.prepare('UPDATE ws_tickets SET expires_at = ? WHERE ticket_hash = ?')
      .bind(Math.floor(Date.now() / 1000) - 1, await hashApiKey(ticket)).run();
    expect((await open(runA, ticket)).status).toBe(401);
  });

  it('refuses a ticket it never issued, and an empty one', async () => {
    expect((await open(runA, 'f'.repeat(64))).status).toBe(401);
    expect((await open(runA, 'not-a-ticket')).status).toBe(401);
    expect((await open(runA, '')).status).toBe(401);
    expect(forwarded).toEqual([]);
  });

  it('is not spent by a request that is not a WebSocket upgrade', async () => {
    const { ticket } = await service.issueStreamTicket(runA, owner);
    expect((await open(runA, ticket, 'h2c')).status).toBe(426);
    expect(await (await open(runA, ticket)).text()).toBe('connected');
  });

  it('is issued only to a signed-in user who can see the run', async () => {
    await expect(service.issueStreamTicket(runA, null)).rejects.toThrow('Unauthorized|401');
    await expect(service.issueStreamTicket(runA, 'someone-else')).rejects.toThrow('Forbidden|403');
    await expect(service.issueStreamTicket(crypto.randomUUID(), owner)).rejects.toThrow('Run/Scan not found|404');
  });

  it('is not issued past the live tickets one user may hold, and expired ones make room', async () => {
    const user = `cap-${crypto.randomUUID()}`;
    await baseEnv.DB.prepare("UPDATE scans SET user_id = ? WHERE id = ?").bind(user, runA).run();
    const issued: string[] = [];
    for (let i = 0; i < MAX_LIVE_STREAM_TICKETS; i++) issued.push((await service.issueStreamTicket(runA, user)).ticket);
    await expect(service.issueStreamTicket(runA, user)).rejects.toThrow('|429');

    await baseEnv.DB.prepare('UPDATE ws_tickets SET expires_at = ? WHERE ticket_hash = ?')
      .bind(Math.floor(Date.now() / 1000) - 1, await hashApiKey(issued[0])).run();
    await expect(service.issueStreamTicket(runA, user)).resolves.toMatchObject({ expiresIn: STREAM_TICKET_TTL_SECONDS });
    const { n } = (await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM ws_tickets WHERE user_id = ?').bind(user).first<{ n: number }>())!;
    expect(n).toBe(MAX_LIVE_STREAM_TICKETS);
  });

  it('is deleted by the cleanup once it has expired', async () => {
    const { ticket: stale } = await service.issueStreamTicket(runA, owner);
    const { ticket: fresh } = await service.issueStreamTicket(runA, owner);
    await baseEnv.DB.prepare('UPDATE ws_tickets SET expires_at = ? WHERE ticket_hash = ?')
      .bind(Math.floor(Date.now() / 1000) - 60, await hashApiKey(stale)).run();

    await new CleanupRepository(baseEnv).cleanupSecurityTables();

    const left = async (t: string) => baseEnv.DB.prepare('SELECT 1 FROM ws_tickets WHERE ticket_hash = ?').bind(await hashApiKey(t)).first();
    expect(await left(stale)).toBeNull();
    expect(await left(fresh)).not.toBeNull();
  });
});

// Through the whole worker, with sign-in on: the global auth middleware must let a ticket reach
// the route, and must still turn away a session token in the URL.
describe('event stream tickets through the API', () => {
  let app: { fetch: (req: Request, env: Env) => Promise<Response> };
  let env: Env;
  let userId: string;
  let runId: string;
  let jwt: string;

  beforeAll(async () => {
    // The schema is already in place: the block above migrated this file's database.
    env = {
      ...baseEnv,
      AUTH_ENABLED: 'true',
      SESSION_CACHE: undefined,
      COORDINATOR_DO: {
        idFromName: () => 'id',
        get: () => ({ fetch: async () => new Response('connected') }),
      },
    } as unknown as Env;
    app = (await import('../../src/index')).default as any;
  });

  beforeEach(async () => {
    userId = crypto.randomUUID();
    runId = crypto.randomUUID();
    await baseEnv.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').bind(userId, `u_${userId.slice(0, 8)}`, 'x').run();
    await baseEnv.DB.prepare(
      "INSERT INTO scans (id, project_id, target_url, profile, status, user_id) VALUES (?, '', 'http://t', 'default', 'queued', ?)"
    ).bind(runId, userId).run();
    const now = Math.floor(Date.now() / 1000);
    jwt = await sign({ sub: userId, iat: now, exp: now + 3600 }, 'test-secret', 'HS256');
  });

  const ticketFor = async (id: string) => {
    const res = await app.fetch(new Request(`http://localhost/api/runs/${id}/stream-ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
    }), env);
    return res;
  };
  const events = (query: string) =>
    app.fetch(new Request(`http://localhost/api/runs/${runId}/events${query}`, { headers: { Upgrade: 'websocket' } }), env);

  it('opens the stream with a ticket from a signed-in request', async () => {
    const res = await ticketFor(runId);
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const { ticket } = await res.json() as { ticket: string };

    const opened = await events(`?ticket=${ticket}`);
    expect(await opened.text()).toBe('connected');
    expect((await events(`?ticket=${ticket}`)).status).toBe(401);
  });

  it('turns away a session token in the URL, and no credentials at all', async () => {
    expect((await events(`?token=${jwt}`)).status).toBe(401);
    expect((await events('')).status).toBe(401);
    expect((await events('?ticket=')).status).toBe(401);
  });

  it('does not issue a ticket without a session', async () => {
    const res = await app.fetch(new Request(`http://localhost/api/runs/${runId}/stream-ticket?token=${jwt}`, {
      method: 'POST',
      headers: { Cookie: 'csrf_token=c1', 'X-CSRF-Token': 'c1' },
    }), env);
    expect(res.status).toBe(401);
  });

  // A ticket opens one thing: on any other route it is refused, even next to a valid session.
  it('refuses a ticket anywhere but the event stream', async () => {
    const { ticket } = await (await ticketFor(runId)).json() as { ticket: string };
    const res = await app.fetch(new Request(`http://localhost/api/projects?ticket=${ticket}`, {
      headers: { Upgrade: 'websocket', Authorization: `Bearer ${jwt}` },
    }), env);
    expect(res.status).toBe(401);
  });

  it('does not open the stream for an account scheduled for deletion', async () => {
    const { ticket } = await (await ticketFor(runId)).json() as { ticket: string };
    await baseEnv.DB.prepare("UPDATE users SET delete_requested_at = datetime('now') WHERE id = ?").bind(userId).run();
    deletionCache.delete(userId); // as requesting the deletion does: the check is the middleware's, cache included
    expect((await events(`?ticket=${ticket}`)).status).toBe(403);
  });
});
