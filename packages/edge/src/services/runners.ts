// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { IRunnersRepository } from '../repositories/runners';
import { IRbacRepository } from '../repositories/rbac';
import { hashApiKey, randomHex } from '../utils/auth';
import { ScansRepository } from '../repositories/scans';
import { isValidRunId, serializeScanConfig, writeScanConfig } from './scanConfigStore';
import { SCAN_NOT_QUEUED } from '../utils/runnerMessages';

export interface IRunnersService {
  connect(
    upgradeHeader: string | undefined,
    token: string | undefined,
    publicKey: string | undefined,
    originalUrl: string,
    rawRequest: any
  ): Promise<Response>;
  getRunners(userId: string | null): Promise<{ runners: any[] }>;
  connectClient(
    runId: string,
    userId: string | null,
    upgradeHeader: string | undefined,
    originalUrl: string,
    rawRequest: any
  ): Promise<Response>;
  issueStreamTicket(runId: string, userId: string | null): Promise<{ ticket: string; expiresIn: number }>;
  queueRun(body: any, userId: string | null, isWebRequest: boolean, isAnon: boolean): Promise<{ id: string; status: string }>;
  stopRun(runId: string, userId: string | null): Promise<{ status: string }>;
  pauseRun(runId: string, userId: string | null): Promise<{ status: string }>;
  resumeRun(runId: string, userId: string | null): Promise<{ status: string }>;
  restartRunner(connectionId: string, userId: string | null): Promise<{ status: string }>;
}

const MIN_SHARED_RUNNER_TOKEN_LENGTH = 32;

/** How long a ticket for a scan's event stream can wait to be used: the dashboard uses it at once. */
export const STREAM_TICKET_TTL_SECONDS = 30;
/** Unused tickets one user may hold at once: a few tabs reconnecting, not a loop filling D1. */
export const MAX_LIVE_STREAM_TICKETS = 20;
const STREAM_TICKET_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The user a ticket for this run's event stream was issued to, or null. It is spent even when it
 * is refused (wrong run, expired). The auth middleware redeems it, so the request is then checked
 * like any other as that user.
 */
export async function redeemStreamTicket(
  repo: Pick<IRunnersRepository, 'consumeStreamTicket'>, ticket: string, runId: string,
): Promise<string | null> {
  if (!STREAM_TICKET_PATTERN.test(ticket)) return null;
  const stored = await repo.consumeStreamTicket(await hashApiKey(ticket));
  if (!stored || stored.runId !== runId || stored.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return stored.userId;
}

/** Constant-time check of a runner token against the operator's SHARED_RUNNER_TOKEN. */
export async function isSharedRunnerToken(token: string, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < MIN_SHARED_RUNNER_TOKEN_LENGTH) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(token)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * The runner list a caller may see: their own runners in full, shared runners without anything
 * that identifies or targets them, and nothing at all about other tenants' runners.
 */
export function filterRunnersForUser(runners: any[], userId: string): any[] {
  const visible: any[] = [];
  for (const { ownerId, ...r } of runners) {
    if (ownerId && ownerId === userId) {
      visible.push({ ...r, isMine: true });
    } else if (r.isShared) {
      visible.push({ name: r.name, status: r.status, isShared: true, version: r.version, isMine: false });
    }
  }
  return visible;
}

export class RunnersService implements IRunnersService {
  constructor(
    private env: Env, 
    private runnersRepo: IRunnersRepository,
    private rbacRepo: IRbacRepository
  ) {}

  private async checkScanAccess(scanId: string, userId: string, permission?: string): Promise<void> {
    if (!isValidRunId(scanId) || (userId && !isValidRunId(userId))) throw new Error('Run/Scan not found|404');
    const scan = await this.runnersRepo.getScanDetails(scanId);
    if (!scan) throw new Error('Run/Scan not found|404');

    if (!scan.project_id) {
      if (scan.user_id !== userId) throw new Error('Forbidden|403');
      return;
    }

    const perm = permission || 'get:/api/projects/:id';
    const hasAccess = await this.rbacRepo.checkPermission(userId, scan.project_id, perm);
    if (!hasAccess) throw new Error('Forbidden|403');
  }

  async connect(
    upgradeHeader: string | undefined,
    token: string | undefined,
    publicKey: string | undefined,
    originalUrl: string,
    rawRequest: any
  ): Promise<Response> {
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    let userId = "";
    let isShared = false;
    if (String(this.env.AUTH_ENABLED) === 'false') {
      userId = "anon-dev-user";
    } else if (!publicKey && token && await isSharedRunnerToken(token, this.env.SHARED_RUNNER_TOKEN)) {
      isShared = true;
    } else if (publicKey) {
      publicKey = publicKey.toLowerCase();
      const user = await this.runnersRepo.getUserByPublicKey(publicKey);
      if (!user) {
        return new Response('Unauthorized: Invalid public key', { status: 401 });
      }
      userId = user.id;
    } else if (token) {
      const hashedToken = await hashApiKey(token);
      let user = await this.runnersRepo.getUserByApiKey(hashedToken);
      if (!user && token.startsWith('swazz_live_')) {
        user = await this.runnersRepo.getUserByApiKey(token);
        if (user) {
          try {
            await this.runnersRepo.updateUserApiKey(user.id, hashedToken);
          } catch {
            // ignore
          }
        }
      }
      if (!user) {
        return new Response('Unauthorized: Invalid runner token', { status: 401 });
      }
      userId = user.id;
    } else {
      return new Response('Unauthorized: Missing token or X-Runner-Public-Key header', { status: 401 });
    }

    if (!isShared) {
      const deleteRequestedAt = await this.runnersRepo.getDeleteRequestedAt(userId);
      if (deleteRequestedAt !== null) {
        return new Response('Forbidden: Account is scheduled for deletion', { status: 403 });
      }
    }

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const req = new Request(originalUrl, rawRequest);
    const url = new URL(req.url);
    url.pathname = '/connect-runner';
    // The coordinator trusts these parameters, so whatever the client put in the query is replaced.
    url.searchParams.delete('public_key');
    url.searchParams.delete('user_id');
    url.searchParams.delete('shared');
    if (publicKey) {
      url.searchParams.set('public_key', publicKey);
    }
    if (isShared) {
      url.searchParams.set('shared', '1');
    } else if (userId) {
      url.searchParams.set('user_id', userId);
    }
    return stub.fetch(new Request(url.toString(), req));
  }

  async getRunners(userId: string | null) {
    if (!userId) {
      throw new Error('Unauthorized|401');
    }

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const res = await stub.fetch(new Request('http://do/runners'));
    if (!res.ok) {
      throw new Error('Failed to fetch runners|500');
    }

    const data = await res.json() as { runners: any[] };
    if (String(this.env.AUTH_ENABLED) === 'false') {
      // Auth-disabled (local) mode has no tenants: every runner is the operator's own.
      return { runners: data.runners.map(({ ownerId, ...r }) => ({ ...r, isMine: true })) };
    }
    return { runners: filterRunnersForUser(data.runners, userId) };
  }

  async connectClient(
    runId: string,
    userId: string | null,
    upgradeHeader: string | undefined,
    originalUrl: string,
    rawRequest: any
  ): Promise<Response> {
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    if (this.env.AUTH_ENABLED === 'true' && !userId) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (userId) {
      await this.checkScanAccess(runId, userId, 'get:/api/projects/:id/scans');
    }

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const req = new Request(originalUrl, rawRequest);
    const url = new URL(req.url);
    url.pathname = '/connect-client';
    // The coordinator authenticates nothing itself; credentials stop here.
    url.searchParams.delete('ticket');
    url.searchParams.delete('token');
    url.searchParams.set('runId', runId);
    return stub.fetch(new Request(url.toString(), req));
  }

  /**
   * A one-time ticket that opens this run's event stream as this user. Browsers cannot set headers
   * on a WebSocket, and a session JWT in its URL ends up in proxy and Cloudflare logs; a ticket
   * there is worth nothing once used or 30 seconds old. Issued only to a caller who could open the
   * stream with their own credentials, and access is checked again when it is used.
   */
  async issueStreamTicket(runId: string, userId: string | null): Promise<{ ticket: string; expiresIn: number }> {
    if (!userId) throw new Error('Unauthorized|401');
    await this.checkScanAccess(runId, userId, 'get:/api/projects/:id/scans');

    const ticket = randomHex(32);
    const expiresAt = Math.floor(Date.now() / 1000) + STREAM_TICKET_TTL_SECONDS;
    const stored = await this.runnersRepo.createStreamTicket(await hashApiKey(ticket), userId, runId, expiresAt, MAX_LIVE_STREAM_TICKETS);
    if (!stored) throw new Error('Too many requests. Please try again later.|429');
    return { ticket, expiresIn: STREAM_TICKET_TTL_SECONDS };
  }

  async queueRun(body: any, userId: string | null, isWebRequest: boolean, isAnon: boolean) {
    if (this.env.LIMIT_ANONYMOUS === 'true' && isWebRequest && isAnon) {
      let endpointCount = 0;
      const config = body.config || {};
      const endpoints = config.endpoints;
      if (endpoints) {
        if (Array.isArray(endpoints)) {
          endpointCount = endpoints.length;
        } else if (Array.isArray(endpoints.include)) {
          endpointCount = endpoints.include.length;
        }
      }
      if (endpointCount > 50) {
        throw new Error('Anonymous limit reached: You can only scan up to 50 endpoints.|403');
      }
    }

    let userPublicKey = "";
    // For standalone scans, we just proceed. For project scans, check permissions.
    if (body.projectId) {
      if (isAnon) {
        throw new Error('Forbidden|403');
      }
      if (this.env.AUTH_ENABLED === 'true') {
        if (!userId) {
          throw new Error('Unauthorized|401');
        }
        const hasAccess = await this.rbacRepo.checkPermission(userId, body.projectId, 'post:/api/projects/:id/scans');
        if (!hasAccess) {
          throw new Error('Forbidden|403');
        }
      } else if (userId) {
        const hasAccess = await this.rbacRepo.checkPermission(userId, body.projectId, 'post:/api/projects/:id/scans');
        if (!hasAccess) {
          throw new Error('Forbidden|403');
        }
      }
    }
    
    if (userId) {
      try {
        const key = await this.runnersRepo.getUserPublicKey(userId);
        if (key) {
          userPublicKey = key;
        }
      } catch (dbErr) {
        console.error("Failed to query user public key in /api/runs:", dbErr);
      }
    }

    const runId = body.runId || crypto.randomUUID();
    if (!isValidRunId(runId)) {
      throw new Error('Invalid runId|400');
    }
    if (body.config !== undefined && body.config !== null && (typeof body.config !== 'object' || Array.isArray(body.config))) {
      throw new Error('config must be an object|400');
    }

    const { body: configBody } = serializeScanConfig(body.config || {});

    const projectId = body.projectId || "";
    const targetUrl = body.config?.base_url || "";
    const profile = (body.config?.profiles && body.config.profiles[0]) || "default";
    const status = 'queued';

    try {
      await this.runnersRepo.createScanRecord(runId, projectId, targetUrl, profile, status, userId);
    } catch (dbErr: any) {
      console.error("Failed to insert scan into D1 in /api/runs:", dbErr);
      const errMsg = String(dbErr?.message || dbErr);
      if (errMsg.includes('UNIQUE') || errMsg.includes('PRIMARY KEY') || errMsg.includes('SQLITE_CONSTRAINT')) {
        throw new Error('Run already exists|409');
      }
      throw new Error('Failed to create scan|500');
    }

    let configKey: string;
    try {
      configKey = await writeScanConfig(this.env, runId, configBody);
      await this.env.SCAN_QUEUE.send({
        runId,
        configKey,
        userPublicKey,
        targetUrl,
        profile,
        projectId,
        userId: userId
      });
    } catch (err: any) {
      console.error("Failed to process scan config or queue run in /api/runs:", err);
      try {
        const scansRepo = new ScansRepository(this.env);
        await scansRepo.updateScanStatus(runId, 'failed', undefined, undefined, SCAN_NOT_QUEUED);
      } catch (statusErr) {
        console.error("Failed to mark scan as failed after R2/queue error in /api/runs:", statusErr);
      }
      throw new Error('Failed to queue scan|500');
    }

    return { id: runId, status: 'queued' };
  }

  async stopRun(runId: string, userId: string | null) {
    if (this.env.AUTH_ENABLED === 'true' && !userId) {
      throw new Error('Unauthorized|401');
    }
    if (userId) {
      await this.checkScanAccess(runId, userId, 'post:/api/projects/:id/scans');
    }

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const doReq = new Request('http://do/command', {
      method: 'POST',
      body: JSON.stringify({ runId, command: 'stop' }),
    });
    await stub.fetch(doReq);
    return { status: 'stopped' };
  }

  async pauseRun(runId: string, userId: string | null) {
    if (this.env.AUTH_ENABLED === 'true' && !userId) {
      throw new Error('Unauthorized|401');
    }
    if (userId) {
      await this.checkScanAccess(runId, userId, 'post:/api/projects/:id/scans');
    }

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const doReq = new Request('http://do/command', {
      method: 'POST',
      body: JSON.stringify({ runId, command: 'pause' }),
    });
    await stub.fetch(doReq);

    const scansRepo = new ScansRepository(this.env);
    if (!(await scansRepo.changeActiveStatus(runId, ['queued', 'dispatched'], 'paused'))) {
      throw new Error('The scan has already ended|409');
    }

    return { status: 'paused' };
  }

  async resumeRun(runId: string, userId: string | null) {
    if (this.env.AUTH_ENABLED === 'true' && !userId) {
      throw new Error('Unauthorized|401');
    }
    if (userId) {
      await this.checkScanAccess(runId, userId, 'post:/api/projects/:id/scans');
    }

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const doReq = new Request('http://do/command', {
      method: 'POST',
      body: JSON.stringify({ runId, command: 'resume' }),
    });
    await stub.fetch(doReq);

    const scansRepo = new ScansRepository(this.env);
    if (!(await scansRepo.changeActiveStatus(runId, ['paused'], 'dispatched'))) {
      throw new Error('The scan has already ended|409');
    }

    return { status: 'resumed' };
  }

  async restartRunner(connectionId: string, userId: string | null) {
    if (!isValidRunId(connectionId)) {
      throw new Error('Runner not found|404');
    }
    if (!userId) {
      throw new Error('Unauthorized|401');
    }

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const doRes = await stub.fetch(
      new Request(`http://do/runners/restart?connectionId=${encodeURIComponent(connectionId)}&userId=${encodeURIComponent(userId)}`, {
        method: 'POST'
      })
    );

    if (!doRes.ok) {
      const errMsg = await doRes.text();
      const status = doRes.status;
      throw new Error((errMsg || 'Failed to restart runner') + `|${status}`);
    }

    return { status: 'restarted' };
  }
}
