import { Env } from '../env';
import { BaseService } from './base';

export interface IScansRepository {
  createScan(id: string, projectId: string, targetUrl: string, profile: string, status: string, userId?: string | null): Promise<void>;
  getUserPublicKey(userId: string): Promise<string | null>;
  getUserDetails(userId: string): Promise<{ username: string } | null>;
  getProjectMemberRole(projectId: string, userId: string): Promise<string | null>;
  createAuditLog(
    id: string,
    projectId: string,
    userId: string | null,
    username: string | null,
    role: string | null,
    action: string,
    actionLabel: string,
    source: string,
    details: string,
    ip: string | null
  ): Promise<void>;
  
  getScans(projectId: string): Promise<any[]>;
  getScan(scanId: string): Promise<any | null>;
  updateScan(scanId: string, fields: Record<string, any>): Promise<any>;
  updateScanReportUrl(scanId: string, reportUrl: string): Promise<void>;
  
  getRunnerLogs(scanId: string): Promise<any[]>;
  getFindings(scanId: string): Promise<any[]>;
  getFindingDetails(findingId: string): Promise<any | null>;
  updateFinding(findingId: string, fields: Record<string, any>): Promise<any>;

  getScheduledScanConfigs(): Promise<{ id: string; project_id: string; name: string; config_json: string; cron_schedule: string; last_run_at: string | null }[]>;
  getProjectOwnerForScan(projectId: string): Promise<{ id: string; public_key: string | null; plan: string | null } | undefined>;
  triggerScheduledScan(runId: string, projectId: string, targetUrl: string, profile: string, status: string, userId: string, configId: string, nowIso: string): Promise<void>;

  getCachedSwagger(url: string): Promise<{ base_path: string; endpoints_r2_key: string; fetched_at: string } | null>;
  getCachedSwaggerDetails(url: string): Promise<{ endpoints_hash: string; endpoints_r2_key: string; raw_spec_r2_key: string } | null>;
  upsertSwaggerCache(url: string, basePath: string, endpointsHash: string, endpointsR2Key: string | undefined, rawSpecR2Key: string | undefined): Promise<void>;
  updateScanStatus(scanId: string, status: string, summaryStats?: string): Promise<void>;
  getQueuedScans(): Promise<any[]>;
  getScanConfigByProject(projectId: string, profileName: string): Promise<string | null>;
  processFindingsQueueMessages(messages: any[]): Promise<void>;
}

export class ScansRepository extends BaseService implements IScansRepository {
  constructor(env: Env) {
    super(env);
  }

  async createScan(id: string, projectId: string, targetUrl: string, profile: string, status: string, userId?: string | null): Promise<void> {
    await this.db.prepare(
      `INSERT INTO scans (id, project_id, target_url, profile, status, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(id, projectId, targetUrl, profile, status, userId ?? null)
      .run();
  }

  async getUserPublicKey(userId: string): Promise<string | null> {
    const user = await this.db.prepare('SELECT public_key FROM users WHERE id = ?')
      .bind(userId)
      .first<{ public_key: string | null }>();
    return user ? user.public_key : null;
  }

  async getUserDetails(userId: string): Promise<{ username: string } | null> {
    const user = await this.db.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first<{ username: string }>();
    return user || null;
  }

  async getProjectMemberRole(projectId: string, userId: string): Promise<string | null> {
    const member = await this.db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').bind(projectId, userId).first<{ role: string }>();
    return member ? member.role : null;
  }

  async createAuditLog(
    id: string,
    projectId: string,
    userId: string | null,
    username: string | null,
    role: string | null,
    action: string,
    actionLabel: string,
    source: string,
    details: string,
    ip: string | null
  ): Promise<void> {
    await this.db.prepare(
      `INSERT INTO audit_logs (id, project_id, user_id, actor_username, actor_role, action, action_label, source, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, projectId, userId,
      username, role,
      action, actionLabel,
      source, details, ip
    ).run();
  }

  async getScans(projectId: string): Promise<any[]> {
    const { results } = await this.db.prepare(
      'SELECT * FROM scans WHERE project_id = ? ORDER BY created_at DESC'
    ).bind(projectId).all();
    return results || [];
  }

  async getScan(scanId: string): Promise<any | null> {
    const scan = await this.db.prepare('SELECT * FROM scans WHERE id = ?')
      .bind(scanId)
      .first();
    return scan || null;
  }

  async updateScan(scanId: string, fields: Record<string, any>): Promise<any> {
    const allowedFields = ['status', 'summary_stats', 'report_url', 'completed_at'] as const;
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(fields[field]);
      }
    }

    if (setClauses.length === 0) {
      throw new Error('No valid fields to update|400');
    }

    values.push(scanId);
    await this.db.prepare(`UPDATE scans SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return this.getScan(scanId);
  }

  async updateScanReportUrl(scanId: string, reportUrl: string): Promise<void> {
    await this.db.prepare('UPDATE scans SET report_url = ?, is_encrypted = 1 WHERE id = ?')
      .bind(reportUrl, scanId)
      .run();
  }

  async getRunnerLogs(scanId: string): Promise<any[]> {
    const { results } = await this.db.prepare(
      "SELECT * FROM scan_events WHERE scan_id = ? AND type = 'event' AND json_extract(payload, '$.type') = 'runner_log' ORDER BY created_at ASC"
    ).bind(scanId).all();
    return results || [];
  }

  async getFindings(scanId: string): Promise<any[]> {
    const { results } = await this.db.prepare('SELECT * FROM findings WHERE scan_id = ?')
      .bind(scanId)
      .all();
    return results || [];
  }

  async getFindingDetails(findingId: string): Promise<any | null> {
    const row = await this.db.prepare(
      'SELECT f.*, s.project_id, s.user_id FROM findings f JOIN scans s ON f.scan_id = s.id WHERE f.id = ?'
    ).bind(findingId).first();
    return row || null;
  }

  async updateFinding(findingId: string, fields: Record<string, any>): Promise<any> {
    const allowedFields = [
      'ai_status',
      'ai_relevance',
      'ai_explanation',
      'ai_remediation',
      'ai_proposed_patch',
      'pr_link'
    ] as const;

    const setClauses: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(fields[field]);
      }
    }

    if (setClauses.length === 0) {
      throw new Error('No valid fields to update|400');
    }

    values.push(findingId);
    await this.db.prepare(`UPDATE findings SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    return this.getFindingDetails(findingId);
  }

  async getScheduledScanConfigs(): Promise<{ id: string; project_id: string; name: string; config_json: string; cron_schedule: string; last_run_at: string | null }[]> {
    const { results } = await this.db.prepare(
      "SELECT id, project_id, name, config_json, cron_schedule, last_run_at FROM scan_configs WHERE cron_schedule IS NOT NULL"
    ).all<{ id: string; project_id: string; name: string; config_json: string; cron_schedule: string; last_run_at: string | null }>();
    return results || [];
  }

  async getProjectOwnerForScan(projectId: string): Promise<{ id: string; public_key: string | null; plan: string | null } | undefined> {
    const { results: owners } = await this.db.prepare(`
      SELECT u.id, u.public_key, u.plan
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ? AND pm.role = 'owner'
    `).bind(projectId).all<{ id: string; public_key: string | null; plan: string | null }>();
    
    if (!owners || owners.length === 0) return undefined;
    return owners.find(o => o.plan === 'Supporter Plan') || owners[0];
  }

  async triggerScheduledScan(runId: string, projectId: string, targetUrl: string, profile: string, status: string, userId: string, configId: string, nowIso: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO scans (id, project_id, target_url, profile, status, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(runId, projectId, targetUrl, profile, status, userId),
      this.db.prepare(
        "UPDATE scan_configs SET last_run_at = ? WHERE id = ?"
      ).bind(nowIso, configId)
    ]);
  }

  async getCachedSwagger(url: string): Promise<{ base_path: string; endpoints_r2_key: string; fetched_at: string } | null> {
    const row = await this.db.prepare(
      'SELECT base_path, endpoints_r2_key, fetched_at FROM swagger_cache WHERE url = ?'
    ).bind(url).first<{ base_path: string; endpoints_r2_key: string; fetched_at: string }>();
    return row || null;
  }

  async getCachedSwaggerDetails(url: string): Promise<{ endpoints_hash: string; endpoints_r2_key: string; raw_spec_r2_key: string } | null> {
    const row = await this.db.prepare(
      'SELECT endpoints_hash, endpoints_r2_key, raw_spec_r2_key FROM swagger_cache WHERE url = ?'
    ).bind(url).first<{ endpoints_hash: string; endpoints_r2_key: string; raw_spec_r2_key: string }>();
    return row || null;
  }

  async upsertSwaggerCache(url: string, basePath: string, endpointsHash: string, endpointsR2Key: string | undefined, rawSpecR2Key: string | undefined): Promise<void> {
    await this.db.prepare('INSERT OR REPLACE INTO swagger_cache (url, base_path, endpoints_hash, endpoints_r2_key, raw_spec_r2_key, fetched_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
      .bind(url, basePath, endpointsHash, endpointsR2Key, rawSpecR2Key)
      .run();
  }

  async updateScanStatus(scanId: string, status: string, summaryStats?: string): Promise<void> {
    if (status === 'completed' && summaryStats) {
      await this.db.prepare("UPDATE scans SET status = 'completed', completed_at = datetime('now'), summary_stats = ? WHERE id = ?").bind(summaryStats, scanId).run();
    } else if (status === 'failed') {
      await this.db.prepare("UPDATE scans SET status = 'failed', completed_at = datetime('now') WHERE id = ?").bind(scanId).run();
    } else if (status === 'dispatched') {
      await this.db.prepare("UPDATE scans SET status = 'dispatched' WHERE id = ?").bind(scanId).run();
    } else {
      await this.db.prepare('UPDATE scans SET status = ? WHERE id = ?').bind(status, scanId).run();
    }
  }

  async getQueuedScans(): Promise<any[]> {
    const { results } = await this.db.prepare(`
      SELECT scans.*, users.public_key AS userPublicKey
      FROM scans
      LEFT JOIN users ON scans.user_id = users.id
      WHERE scans.status = 'queued'
      ORDER BY scans.created_at ASC
    `).all<any>();
    return results || [];
  }

  async getScanConfigByProject(projectId: string, profileName: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT config_json FROM scan_configs WHERE project_id = ? AND name = ?").bind(projectId, profileName).first<{config_json: string}>();
    return row ? row.config_json : null;
  }

  async processFindingsQueueMessages(messages: any[]): Promise<void> {
    const statements: any[] = [];
    for (const msg of messages) {
      const id = crypto.randomUUID();
      const { scanId, type, payload } = msg.body;
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      
      statements.push(
        this.db.prepare(
          `INSERT INTO scan_events (id, scan_id, type, payload) VALUES (?, ?, ?, ?)`
        ).bind(id, scanId, type, payloadStr)
      );

      if (payload && payload.type === 'complete') {
        statements.push(
          this.db.prepare(
            `UPDATE scans SET status = ?, completed_at = datetime('now'), summary_stats = ? WHERE id = ?`
          ).bind('completed', JSON.stringify(payload.data || {}), scanId)
        );
      } else if (type === 'error' || (payload && payload.type === 'error')) {
        statements.push(
          this.db.prepare(
            `UPDATE scans SET status = ?, completed_at = datetime('now') WHERE id = ?`
          ).bind('failed', scanId)
        );
      }

      // Populate findings table for analytics & detail queries
      if (payload && payload.type === 'result' && payload.data && Array.isArray(payload.data.analyzerFindings)) {
        for (const finding of payload.data.analyzerFindings) {
          const findingId = crypto.randomUUID();
          statements.push(
            this.db.prepare(
              `INSERT INTO findings (id, scan_id, rule_id, level, message, evidence)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(
              findingId,
              scanId,
              finding.ruleId,
              finding.level,
              finding.message,
              finding.evidence || null
            )
          );
        }
      }
    }

    if (statements.length > 0) {
      await this.db.batch(statements);
    }
  }
}
