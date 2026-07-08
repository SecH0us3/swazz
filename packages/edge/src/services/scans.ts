import { Env } from '../env';
import { IScansRepository } from '../repositories/scans';
import { IRbacRepository } from '../repositories/rbac';
import { sign, verify } from 'hono/jwt';
import { ulid } from 'ulidx';

export interface IScansService {
  createScan(
    body: any,
    userId: string | null,
    authHeader: string,
    clientIp: string,
    waitUntil?: (p: Promise<any>) => void
  ): Promise<{ id: string; status: string }>;
  getScans(projectId: string, userId: string | null): Promise<{ scans: any[] }>;
  getScan(scanId: string, userId: string | null): Promise<{ scan: any }>;
  updateScan(scanId: string, body: any, userId: string | null): Promise<{ scan: any }>;
  generateUploadUrl(scanId: string, userId: string | null): Promise<any>;
  uploadReport(scanId: string, token: string | undefined, bodyStream: ReadableStream<Uint8Array> | null): Promise<any>;
  getRunnerLogs(scanId: string, userId: string | null, isAuthEnabled: boolean): Promise<{ logs: any[] }>;
  getFindings(scanId: string, userId: string | null, isAuthEnabled: boolean): Promise<{ findings: any[] }>;
  getFindingDetails(findingId: string, userId: string | null, isAuthEnabled: boolean): Promise<{ finding: any }>;
  updateFinding(findingId: string, body: any, userId: string | null, isAuthEnabled: boolean): Promise<{ finding: any }>;
}

export class ScansService implements IScansService {
  constructor(
    private env: Env, 
    private scansRepo: IScansRepository,
    private rbacRepo: IRbacRepository
  ) {}

  private async checkScanAccess(scan: any, userId: string | null, isAuthEnabled: boolean): Promise<void> {
    if (!isAuthEnabled) return;
    if (!userId) throw new Error('Unauthorized|401');

    if (!scan.project_id) {
      if (scan.user_id !== userId) throw new Error('Forbidden|403');
      return;
    }

    const hasAccess = await this.rbacRepo.checkPermission(userId, scan.project_id, 'get:/api/projects/:id/scans');
    if (!hasAccess) throw new Error('Forbidden|403');
  }

  async createScan(
    body: any,
    userId: string | null,
    authHeader: string,
    clientIp: string,
    waitUntil?: (p: Promise<any>) => void
  ) {
    if (!body.project_id || !body.target_url || !body.profile) {
      throw new Error('Missing required fields: project_id, target_url, profile|400');
    }

    const isAuthEnabled = this.env.AUTH_ENABLED === 'true';
    if (isAuthEnabled && !userId) {
      throw new Error('Unauthorized|401');
    }
    if (userId) {
      const hasAccess = await this.rbacRepo.checkPermission(userId, body.project_id, 'post:/api/projects/:id/scans');
      if (!hasAccess) throw new Error('Forbidden|403');
    }

    const id = ulid();
    const status = 'queued';

    await this.scansRepo.createScan(id, body.project_id, body.target_url, body.profile, status, userId);

    let userPublicKey = "";
    if (userId) {
      try {
        const key = await this.scansRepo.getUserPublicKey(userId);
        if (key) {
          userPublicKey = key;
        }
      } catch (dbErr) {
        console.error("Failed to query user public key in /api/scans:", dbErr);
      }
    }

    await this.env.SCAN_QUEUE.send({
      runId: id,
      config: body.config || {},
      userPublicKey,
      targetUrl: body.target_url,
      profile: body.profile,
      projectId: body.project_id,
      userId
    });

    // Fire-and-forget audit log
    const auditPromise = (async () => {
      try {
        const projectId = body.project_id;
        const [userRow, memberRow] = await Promise.all([
          userId ? this.scansRepo.getUserDetails(userId) : Promise.resolve(null),
          userId ? this.scansRepo.getProjectMemberRole(projectId, userId) : Promise.resolve(null),
        ]);
        const details = JSON.stringify({
          target_url: body.target_url,
          profile: body.profile
        });
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        const source = token.startsWith('swazz_live_') ? 'api_key' : 'web';
        await this.scansRepo.createAuditLog(
          ulid(), projectId, userId,
          userRow?.username ?? null, memberRow ?? null,
          'post:/api/projects/:id/scans', 'Started scan',
          source, details, clientIp || null
        );
      } catch (err) {
        console.error('[auditLog] Failed to write scan audit log:', err);
      }
    })();

    if (waitUntil) {
      waitUntil(auditPromise);
    } else {
      auditPromise.catch(() => {});
    }

    return { id, status: 'queued' };
  }

  async getScans(projectId: string, userId: string | null) {
    if (!projectId) {
      throw new Error('Missing query parameter: project_id|400');
    }

    const isAuthEnabled = this.env.AUTH_ENABLED === 'true';
    if (isAuthEnabled && !userId) {
      throw new Error('Unauthorized|401');
    }
    if (userId) {
      const hasAccess = await this.rbacRepo.checkPermission(userId, projectId, 'get:/api/projects/:id/scans');
      if (!hasAccess) throw new Error('Forbidden|403');
    }

    const scans = await this.scansRepo.getScans(projectId);
    return { scans };
  }

  async getScan(scanId: string, userId: string | null) {
    const scan = await this.scansRepo.getScan(scanId);
    if (!scan) throw new Error('Scan not found|404');

    const isAuthEnabled = this.env.AUTH_ENABLED === 'true';
    if (isAuthEnabled && !userId) {
      throw new Error('Unauthorized|401');
    }
    if (userId) {
      const hasAccess = await this.rbacRepo.checkPermission(userId, scan.project_id, 'get:/api/projects/:id/scans');
      if (!hasAccess) throw new Error('Forbidden|403');
    }

    return { scan };
  }

  async updateScan(scanId: string, body: any, userId: string | null) {
    const scan = await this.scansRepo.getScan(scanId);
    if (!scan) throw new Error('Scan not found|404');

    const isAuthEnabled = this.env.AUTH_ENABLED === 'true';
    if (isAuthEnabled && !userId) {
      throw new Error('Unauthorized|401');
    }
    if (userId) {
      const hasAccess = await this.rbacRepo.checkPermission(userId, scan.project_id, 'post:/api/projects/:id/scans');
      if (!hasAccess) throw new Error('Forbidden|403');
    }

    const updated = await this.scansRepo.updateScan(scanId, body);
    return { scan: updated };
  }

  async generateUploadUrl(scanId: string, userId: string | null) {
    const scan = await this.scansRepo.getScan(scanId);
    if (!scan) throw new Error('Scan not found|404');

    const isAuthEnabled = this.env.AUTH_ENABLED === 'true';
    if (isAuthEnabled && !userId) {
      throw new Error('Unauthorized|401');
    }
    if (userId) {
      const hasAccess = await this.rbacRepo.checkPermission(userId, scan.project_id, 'post:/api/projects/:id/scans');
      if (!hasAccess) throw new Error('Forbidden|403');
    }

    const r2Key = `reports/${scanId}.enc`;
    const secret = this.env.JWT_SECRET;
    if (!secret) throw new Error('Internal server error: auth not configured|500');

    const uploadToken = await sign(
      {
        purpose: 'upload',
        scan_id: scanId,
        r2_key: r2Key,
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
      },
      secret
    );

    return {
      upload_token: uploadToken,
      r2_key: r2Key,
      method: 'PUT',
      url: `/api/scans/${scanId}/upload`,
      expires_in: 900,
    };
  }

  async uploadReport(scanId: string, token: string | undefined, bodyStream: ReadableStream<Uint8Array> | null) {
    if (!token) throw new Error('Missing X-Upload-Token header|401');

    const secret = this.env.JWT_SECRET;
    if (!secret) throw new Error('Internal server error: auth not configured|500');

    try {
      const decoded = await verify(token, secret, "HS256") as {
        purpose: string;
        scan_id: string;
        r2_key: string;
        exp: number;
      };

      if (decoded.purpose !== 'upload' || decoded.scan_id !== scanId) {
        throw new Error('Token does not match this scan|403');
      }

      if (!bodyStream) throw new Error('Empty body|400');

      await this.env.STORAGE.put(decoded.r2_key, bodyStream, {
        customMetadata: {
          scan_id: scanId,
          uploaded_at: new Date().toISOString(),
        },
      });

      await this.scansRepo.updateScanReportUrl(scanId, decoded.r2_key);

      return { status: 'uploaded', r2_key: decoded.r2_key };
    } catch (err: any) {
      if (err?.name === 'JwtTokenExpired' || err?.message?.includes('expired')) {
        throw new Error('Upload token expired|401');
      }
      if (err.message.includes('|')) throw err;
      throw new Error('Invalid upload token|403');
    }
  }

  async getRunnerLogs(scanId: string, userId: string | null, isAuthEnabled: boolean) {
    const scan = await this.scansRepo.getScan(scanId);
    if (!scan) throw new Error('Scan not found|404');

    await this.checkScanAccess(scan, userId, isAuthEnabled);

    const logs = await this.scansRepo.getRunnerLogs(scanId);
    return { logs };
  }

  async getFindings(scanId: string, userId: string | null, isAuthEnabled: boolean) {
    const scan = await this.scansRepo.getScan(scanId);
    if (!scan) throw new Error('Scan not found|404');

    await this.checkScanAccess(scan, userId, isAuthEnabled);

    const findings = await this.scansRepo.getFindings(scanId);
    return { findings };
  }

  async getFindingDetails(findingId: string, userId: string | null, isAuthEnabled: boolean) {
    const row = await this.scansRepo.getFindingDetails(findingId);
    if (!row) throw new Error('Finding not found|404');

    await this.checkScanAccess(row, userId, isAuthEnabled);

    return { finding: row };
  }

  async updateFinding(findingId: string, body: any, userId: string | null, isAuthEnabled: boolean, ctx?: any) {
    const finding = await this.scansRepo.getFindingDetails(findingId);
    if (!finding) throw new Error('Finding not found|404');

    if (isAuthEnabled) {
      if (!userId) throw new Error('Unauthorized|401');
      if (!finding.project_id) {
        if (finding.user_id !== userId) throw new Error('Forbidden|403');
      } else {
        const hasAccess = await this.rbacRepo.checkPermission(userId, finding.project_id, 'post:/api/projects/:id/scans');
        if (!hasAccess) throw new Error('Forbidden|403');
      }
    }

    const updated = await this.scansRepo.updateFinding(findingId, body, ctx);
    return { finding: updated };
  }
}
