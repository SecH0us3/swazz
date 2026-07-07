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
}
