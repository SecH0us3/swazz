import { Env } from '../env';
import { IRunnersRepository } from '../repositories/runners';
import { IRbacRepository } from '../repositories/rbac';
import { hashApiKey } from '../utils/auth';

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
  queueRun(body: any, userId: string | null, isWebRequest: boolean, isAnon: boolean): Promise<{ id: string; status: string }>;
  stopRun(runId: string, userId: string | null): Promise<{ status: string }>;
  pauseRun(runId: string, userId: string | null): Promise<{ status: string }>;
  resumeRun(runId: string, userId: string | null): Promise<{ status: string }>;
  restartRunner(connectionId: string, userId: string | null): Promise<{ status: string }>;
}

export class RunnersService implements IRunnersService {
  constructor(
    private env: Env, 
    private runnersRepo: IRunnersRepository,
    private rbacRepo: IRbacRepository
  ) {}

  private async checkScanAccess(scanId: string, userId: string, permission?: string): Promise<void> {
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
    if (publicKey) {
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

    const deleteRequestedAt = await this.runnersRepo.getDeleteRequestedAt(userId);
    if (deleteRequestedAt !== null) {
      return new Response('Forbidden: Account is scheduled for deletion', { status: 403 });
    }

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const req = new Request(originalUrl, rawRequest);
    const url = new URL(req.url);
    url.pathname = '/connect-runner';
    if (publicKey) {
      url.searchParams.set('public_key', publicKey);
    }
    if (userId) {
      url.searchParams.set('user_id', userId);
    }
    return stub.fetch(new Request(url.toString(), req));
  }

  async getRunners(userId: string | null) {
    if (!userId) {
      throw new Error('Unauthorized|401');
    }

    let userPublicKey = await this.runnersRepo.getUserPublicKey(userId);

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const res = await stub.fetch(new Request('http://do/runners'));
    if (!res.ok) {
      throw new Error('Failed to fetch runners|500');
    }

    const data = await res.json() as { runners: any[] };
    const mappedRunners = data.runners.map(r => ({
      ...r,
      isMine: userPublicKey && r.publicKey === userPublicKey,
    }));

    return { runners: mappedRunners };
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
    url.searchParams.set('runId', runId);
    return stub.fetch(new Request(url.toString(), req));
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
    const projectId = body.projectId || "";
    const targetUrl = body.config?.base_url || "";
    const profile = (body.config?.profiles && body.config.profiles[0]) || "default";
    const status = 'queued';

    try {
      await this.runnersRepo.createScanRecord(runId, projectId, targetUrl, profile, status, userId);
    } catch (dbErr) {
      console.error("Failed to insert scan into D1 in /api/runs:", dbErr);
    }

    await this.env.SCAN_QUEUE.send({
      runId,
      config: body.config || {},
      userPublicKey,
      targetUrl,
      profile,
      projectId,
      userId: userId
    });

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
    return { status: 'resumed' };
  }

  async restartRunner(connectionId: string, userId: string | null) {
    if (!userId) {
      throw new Error('Unauthorized|401');
    }

    let userPublicKey = "";
    try {
      const key = await this.runnersRepo.getUserPublicKey(userId);
      if (key) {
        userPublicKey = key;
      }
    } catch (dbErr) {
      console.error("Failed to query user public key in /api/runners/.../restart:", dbErr);
      throw new Error('Internal Server Error|500');
    }

    if (!userPublicKey) {
      throw new Error('Forbidden: You do not own any runners|403');
    }

    const id = this.env.COORDINATOR_DO.idFromName('global-coordinator');
    const stub = this.env.COORDINATOR_DO.get(id);
    const doRes = await stub.fetch(
      new Request(`http://do/runners/restart?connectionId=${encodeURIComponent(connectionId)}&userPublicKey=${encodeURIComponent(userPublicKey)}`, {
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
