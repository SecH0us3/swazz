// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { BaseService } from './base';
import { dispatchWebhook } from '../utils/webhooks';
import { sendScanCompletedDigestEmail } from '../services/email';
import { WorkersAIService } from '../services/ai';
import { logError } from '../../../common/logging/logger';
import { eventIdFor, isValidExec } from '../coordinator/delivery';
import { runnerErrorText, sanitizeRunnerText, UNKNOWN_FAILURE } from '../utils/runnerMessages';

export interface IScansRepository {
  createScan(id: string, projectId: string, targetUrl: string, profile: string, status: string, userId?: string | null, triggerType?: string): Promise<void>;
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
  getFailureReasons(scanIds: string[]): Promise<Map<string, string>>;
  hasActiveScans(): Promise<boolean>;
  getStalledActiveScans(idleMinutes: number, limit: number, owned?: string[], ownedIdleMinutes?: number): Promise<StalledScan[]>;
  getFindings(scanId: string): Promise<any[]>;
  getFindingDetails(findingId: string): Promise<any | null>;
  updateFinding(findingId: string, fields: Record<string, any>, ctx?: any): Promise<any>;

  getScheduledScanConfigs(): Promise<{ id: string; project_id: string; name: string; config_json: string; cron_schedule: string; last_run_at: string | null }[]>;
  getProjectOwnerForScan(projectId: string): Promise<{ id: string; public_key: string | null; plan: string | null } | undefined>;
  triggerScheduledScan(runId: string, projectId: string, targetUrl: string, profile: string, status: string, userId: string, configId: string, nowIso: string): Promise<void>;

  getCachedSwagger(url: string): Promise<{ base_path: string; endpoints_r2_key: string; fetched_at: string } | null>;
  getCachedSwaggerDetails(url: string): Promise<{ endpoints_hash: string; endpoints_r2_key: string; raw_spec_r2_key: string } | null>;
  upsertSwaggerCache(url: string, basePath: string, endpointsHash: string, endpointsR2Key: string | undefined, rawSpecR2Key: string | undefined): Promise<void>;
  updateScanStatus(scanId: string, status: string, summaryStats?: string, ctx?: any, failureReason?: string): Promise<void>;
  markFailedIfActive(scanId: string, reason?: string): Promise<boolean>;
  getScanStatus(scanId: string): Promise<string | null>;
  getQueuedScans(): Promise<any[]>;
  getActiveScans(): Promise<any[]>;
  getScanConfigByProject(projectId: string, profileName: string): Promise<string | null>;
  processFindingsQueueMessages(messages: readonly any[], ctx?: any): Promise<ProcessedEvents>;
  batchUpdateFindingsAI(
    scanId: string,
    updates: Array<{
      finding_id: string;
      ai_status: string;
      ai_relevance?: boolean | null;
      ai_explanation?: string;
      ai_confidence?: number;
    }>
  ): Promise<number>;
  saveWAFPatchReport(scanId: string, report: unknown): Promise<void>;
}

function normalizeAIRelevance(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    const norm = val.trim().toLowerCase();
    return norm === '1' || norm === '1.0' || norm === 'true' || norm === 'true positive' || norm === 'true_positive' || norm === 'tp';
  }
  return false;
}

const MAX_FINDINGS_PER_EVENT = 1000;
const FINDING_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const FINDING_TEXT_LIMIT = 64 * 1024;

/**
 * Normalizes one runner-reported finding. Runners are tenant-controlled, so anything that is not
 * an object is dropped and every field is coerced to a bounded string; the runner's id is kept
 * (AI triage refers back to it) only when it is a plain identifier.
 */
export function sanitizeRunnerFinding(raw: unknown): { id: string; ruleId: string; level: string; message: string; evidence: string | null } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const f = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
  const ruleId = text(f.ruleId, 256);
  if (!ruleId) return null;
  const evidence = f.evidence == null || f.evidence === '' ? null : text(f.evidence, FINDING_TEXT_LIMIT);
  return {
    id: typeof f.id === 'string' && FINDING_ID_PATTERN.test(f.id) ? f.id : crypto.randomUUID(),
    ruleId,
    level: text(f.level, 32),
    message: text(f.message, FINDING_TEXT_LIMIT),
    evidence,
  };
}

// The statuses of a scan that has not ended.
const ACTIVE_STATUS_SQL = "status IN ('queued','dispatched','paused')";

export interface StalledScan {
  id: string;
  status: 'dispatched' | 'paused';
  idle_minutes: number;
}

/** What processing a batch of runner events changed. */
export interface ProcessedEvents {
  /** Scans this batch ended (completed or failed); a scan that had already ended is not listed. */
  ended: string[];
}

// A stored runner error: the runner's error message, or an event of type "error".
const ERROR_EVENT_SQL = "(type = 'error' OR (type = 'event' AND json_extract(payload, '$.type') = 'error'))";

// D1 allows at most 100 bound parameters per statement.
const EVENT_ID_LOOKUP_CHUNK = 90;

/** The stable scan_events id of a sequenced runner event, or undefined for any other. */
function storedEventId(body: any): string | undefined {
  const { scanId, exec, seq } = body ?? {};
  if (typeof scanId !== 'string' || scanId === '' || !isValidExec(exec)) return undefined;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return undefined;
  return eventIdFor(scanId, exec, seq);
}

export class ScansRepository extends BaseService implements IScansRepository {
  constructor(env: Env) {
    super(env);
  }

  async createScan(id: string, projectId: string, targetUrl: string, profile: string, status: string, userId?: string | null, triggerType: string = 'manual'): Promise<void> {
    await this.db.prepare(
      `INSERT INTO scans (id, project_id, target_url, profile, status, user_id, trigger_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, projectId, targetUrl, profile, status, userId ?? null, triggerType)
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
    // report_url is not client-writable: only uploadReport sets it (to reports/<scanId>.enc), and
    // account-deletion cleanup deletes R2 objects by it.
    const allowedFields = ['status', 'summary_stats', 'completed_at'] as const;
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

  /** The scan's runner log: runner_log events and errors, oldest first. */
  async getRunnerLogs(scanId: string): Promise<any[]> {
    const { results } = await this.db.prepare(
      `SELECT * FROM scan_events WHERE scan_id = ? AND (${ERROR_EVENT_SQL} OR (type = 'event' AND json_extract(payload, '$.type') = 'runner_log')) ORDER BY created_at ASC`
    ).bind(scanId).all();
    return results || [];
  }

  /**
   * Each failed scan's reason, as user-facing text. Read from the scan row; scans that failed
   * before failure_reason existed fall back to their most recent stored error.
   */
  async getFailureReasons(scanIds: string[]): Promise<Map<string, string>> {
    const reasons = new Map<string, string>();
    const ids = Array.from(new Set(scanIds));
    const missing: string[] = [];
    for (let i = 0; i < ids.length; i += EVENT_ID_LOOKUP_CHUNK) {
      const chunk = ids.slice(i, i + EVENT_ID_LOOKUP_CHUNK);
      const { results } = await this.db.prepare(
        `SELECT id, failure_reason FROM scans WHERE id IN (${chunk.map(() => '?').join(',')})`
      ).bind(...chunk).all<{ id: string; failure_reason: string | null }>();
      for (const row of results ?? []) {
        const text = sanitizeRunnerText(row.failure_reason);
        if (text) reasons.set(row.id, text);
        else missing.push(row.id);
      }
    }
    for (let i = 0; i < missing.length; i += EVENT_ID_LOOKUP_CHUNK) {
      const chunk = missing.slice(i, i + EVENT_ID_LOOKUP_CHUNK);
      const { results } = await this.db.prepare(
        `SELECT scan_id, payload FROM scan_events WHERE scan_id IN (${chunk.map(() => '?').join(',')}) AND ${ERROR_EVENT_SQL} ORDER BY created_at DESC`
      ).bind(...chunk).all<{ scan_id: string; payload: string }>();
      for (const row of results ?? []) {
        if (reasons.has(row.scan_id)) continue;
        const text = runnerErrorText(row.payload);
        if (text) reasons.set(row.scan_id, text);
      }
      // Kept on the scan, so the events are searched once per scan, not on every listing.
      await this.db.batch(chunk.map(id =>
        this.db.prepare('UPDATE scans SET failure_reason = ? WHERE id = ? AND failure_reason IS NULL')
          .bind(reasons.get(id) ?? UNKNOWN_FAILURE, id)
      ));
    }
    return reasons;
  }

  /** Whether any scan is dispatched or paused (the stalled scan watchdog has work at all). */
  async hasActiveScans(): Promise<boolean> {
    const row = await this.db.prepare("SELECT 1 AS one FROM scans WHERE status IN ('dispatched', 'paused') LIMIT 1").first();
    return !!row;
  }

  /**
   * Candidates for the stalled scan watchdog: active scans with no activity (event, status change
   * or creation, whichever is latest) for idleMinutes, with how long they have been idle.
   *  - unowned: dispatched or paused scans none of the owned runIds;
   *  - owned: dispatched (not paused) scans among the owned runIds, idle for ownedIdleMinutes.
   * Owned scans never fill the unowned batch (owned paused scans would otherwise crowd out the
   * orphaned ones, every pass).
   */
  async getStalledActiveScans(idleMinutes: number, limit: number, owned: string[] = [], ownedIdleMinutes = idleMinutes): Promise<StalledScan[]> {
    const ownedJson = JSON.stringify(owned);
    const select = (ownership: string, statuses: string, minutes: number) => this.db.prepare(
      `SELECT id, status, CAST((julianday('now') - julianday(last_activity)) * 1440 AS INTEGER) AS idle_minutes FROM (
         SELECT s.id, s.status, MAX(
           COALESCE((SELECT MAX(e.created_at) FROM scan_events e WHERE e.scan_id = s.id), ''),
           COALESCE(s.status_changed_at, ''),
           s.created_at
         ) AS last_activity
         FROM scans s
         WHERE s.status IN (${statuses}) AND s.id ${ownership} (SELECT value FROM json_each(?))
       ) WHERE last_activity < datetime('now', ?) ORDER BY last_activity ASC LIMIT ?`
    ).bind(ownedJson, `-${Math.max(1, Math.floor(minutes))} minutes`, limit).all<StalledScan>();
    const [unowned, ownedSilent] = await Promise.all([
      select('NOT IN', "'dispatched', 'paused'", idleMinutes),
      owned.length > 0 ? select('IN', "'dispatched'", ownedIdleMinutes) : Promise.resolve({ results: [] as StalledScan[] }),
    ]);
    return [...(unowned.results ?? []), ...(ownedSilent.results ?? [])];
  }

  private mapFindingRow(row: any): any {
    if (!row) return row;
    let ai_relevance: boolean | undefined = undefined;
    if (row.ai_relevance !== null && row.ai_relevance !== undefined) {
      ai_relevance = normalizeAIRelevance(row.ai_relevance);
    }
    return {
      ...row,
      ...(ai_relevance !== undefined ? { ai_relevance } : {})
    };
  }

  async getFindings(scanId: string): Promise<any[]> {
    const { results } = await this.db.prepare('SELECT * FROM findings WHERE scan_id = ?')
      .bind(scanId)
      .all();
    return (results || []).map(r => this.mapFindingRow(r));
  }

  async getFindingDetails(findingId: string): Promise<any | null> {
    const row = await this.db.prepare(
      'SELECT f.*, s.project_id, s.user_id FROM findings f JOIN scans s ON f.scan_id = s.id WHERE f.id = ?'
    ).bind(findingId).first();
    return row ? this.mapFindingRow(row) : null;
  }

  async updateFinding(findingId: string, fields: Record<string, any>, ctx?: any): Promise<any> {
    const allowedFields = [
      'ai_status',
      'ai_relevance',
      'ai_explanation',
      'ai_remediation',
      'ai_proposed_patch',
      'pr_link',
      'ai_confidence'
    ] as const;

    const setClauses: string[] = [];
    const values: any[] = [];

    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        if (field === 'ai_relevance') {
          const val = fields[field];
          const relVal = val === null ? null : (normalizeAIRelevance(val) ? 1 : 0);
          values.push(relVal);
        } else {
          values.push(fields[field]);
        }
      }
    }

    if (setClauses.length === 0) {
      throw new Error('No valid fields to update|400');
    }

    values.push(findingId);
    await this.db.prepare(`UPDATE findings SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();

    const updatedFinding = await this.getFindingDetails(findingId);
    if (updatedFinding && updatedFinding.project_id) {
      const dispatchPromise = dispatchWebhook(this.env, updatedFinding.project_id, 'finding.triaged', updatedFinding).catch(err => {
        logError({ env: this.env, executionCtx: ctx }, 'Webhook', "Failed to dispatch finding.triaged webhook", { error: err });
      });
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(dispatchPromise);
      } else {
        await dispatchPromise;
      }
    }

    return updatedFinding;
  }

  async batchUpdateFindingsAI(
    scanId: string,
    updates: Array<{
      finding_id: string;
      ai_status: string;
      ai_relevance?: boolean | null;
      ai_explanation?: string;
      ai_confidence?: number;
    }>
  ): Promise<number> {
    if (!updates || updates.length === 0) return 0;

    const statements: any[] = [];
    for (const u of updates) {
      let relVal: number | null = null;
      if (u.ai_relevance !== undefined && u.ai_relevance !== null) {
        relVal = normalizeAIRelevance(u.ai_relevance) ? 1 : 0;
      }
      statements.push(
        this.db.prepare(
          `UPDATE findings SET ai_status = ?, ai_relevance = ?, ai_explanation = ?, ai_confidence = ? WHERE id = ? AND scan_id = ?`
        ).bind(
          u.ai_status,
          relVal,
          u.ai_explanation ?? null,
          u.ai_confidence ?? null,
          u.finding_id,
          scanId
        )
      );
    }

    await this.db.batch(statements);
    return updates.length;
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
        `INSERT INTO scans (id, project_id, target_url, profile, status, user_id, trigger_type)
         VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`
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

  /**
   * Sets a scan's status, recording when it changed (the stalled scan watchdog counts idle time
   * from it as well as from the scan's events). A failed scan gets failureReason, as the user is
   * told why it failed.
   */
  async updateScanStatus(scanId: string, status: string, summaryStats?: string, ctx?: any, failureReason?: string): Promise<void> {
    if (status === 'completed' && summaryStats) {
      await this.db.prepare("UPDATE scans SET status = 'completed', completed_at = datetime('now'), summary_stats = ?, status_changed_at = datetime('now') WHERE id = ?").bind(summaryStats, scanId).run();
    } else if (status === 'failed') {
      await this.db.prepare("UPDATE scans SET status = 'failed', completed_at = datetime('now'), failure_reason = COALESCE(?, failure_reason), status_changed_at = datetime('now') WHERE id = ?").bind(failureReason ?? null, scanId).run();
    } else if (status === 'dispatched') {
      await this.db.prepare("UPDATE scans SET status = 'dispatched', status_changed_at = datetime('now') WHERE id = ?").bind(scanId).run();
    } else {
      await this.db.prepare("UPDATE scans SET status = ?, status_changed_at = datetime('now') WHERE id = ?").bind(status, scanId).run();
    }

    try {
      const scan = await this.getScan(scanId);
      if (scan && scan.project_id) {
        let eventType = '';
        if (status === 'dispatched') eventType = 'scan.started';
        else if (status === 'completed') eventType = 'scan.completed';
        else if (status === 'failed') eventType = 'scan.failed';

        if (eventType) {
          try {
            await dispatchWebhook(this.env, scan.project_id, eventType, {
              scan_id: scan.id,
              status: scan.status,
              target_url: scan.target_url,
              profile: scan.profile,
              summary_stats: scan.summary_stats ? JSON.parse(scan.summary_stats) : null,
              created_at: scan.created_at,
              completed_at: scan.completed_at
            });
          } catch (err) {
            logError({ env: this.env, executionCtx: ctx }, 'Webhook', "Webhook dispatch failed", { error: err });
          }
        }

        if (status === 'completed') {
          try {
            let targetUser: { email: string; email_verified: number; project_name?: string } | null = null;
            if (scan.user_id) {
              targetUser = await this.db.prepare(`
                SELECT users.email, users.email_verified, projects.name AS project_name
                FROM users
                LEFT JOIN projects ON projects.id = ?
                WHERE users.id = ?
              `).bind(scan.project_id, scan.user_id).first<{ email: string; email_verified: number; project_name?: string }>();
            } else {
              targetUser = await this.db.prepare(`
                SELECT users.email, users.email_verified, projects.name AS project_name
                FROM project_members
                JOIN users ON project_members.user_id = users.id
                JOIN projects ON project_members.project_id = projects.id
                WHERE project_members.project_id = ? AND project_members.role = 'owner' AND users.email_verified = 1
                LIMIT 1
              `).bind(scan.project_id).first<{ email: string; email_verified: number; project_name?: string }>();
            }

            if (targetUser && targetUser.email && targetUser.email_verified === 1) {
              const stats = scan.summary_stats ? (typeof scan.summary_stats === 'string' ? JSON.parse(scan.summary_stats) : scan.summary_stats) as Record<string, number> : {} as Record<string, number>;
              const totalFindings = stats.total_findings ?? stats.findings_count ?? 0;
              const criticalCount = stats.critical ?? 0;
              const highCount = stats.high ?? 0;
              const mediumCount = stats.medium ?? 0;
              const lowCount = stats.low ?? 0;
              const projectName = targetUser.project_name || 'Project';
              const reportUrl = `https://swazz.secmy.app/projects/${scan.project_id}/scans/${scan.id}`;

              let aiBriefing: { summary: string; key_recommendations?: string[] } | undefined = undefined;
              if (totalFindings > 0 && this.env.AI) {
                try {
                  const briefingResult = await WorkersAIService.generateScanBriefing(this.env, {
                    projectName,
                    targetUrl: scan.target_url,
                    totalFindings,
                    criticalCount,
                    highCount,
                    mediumCount,
                    lowCount,
                  });
                  aiBriefing = {
                    summary: briefingResult.summary,
                    key_recommendations: briefingResult.key_recommendations,
                  };
                } catch {
                  // Non-fatal if AI briefing fails
                }
              }

              await sendScanCompletedDigestEmail(this.env, {
                to: targetUser.email,
                projectName,
                targetUrl: scan.target_url,
                scanId: scan.id,
                reportUrl,
                totalFindings,
                criticalCount,
                highCount,
                mediumCount,
                lowCount,
                completedAt: scan.completed_at || new Date().toISOString(),
                aiBriefing,
              });
            }
          } catch (emailErr) {
            logError({ env: this.env, executionCtx: ctx }, 'Email', "Scan completed email dispatch failed", { error: emailErr });
          }
        }
      }
    } catch (webhookErr) {
      logError({ env: this.env, executionCtx: ctx }, 'Webhook', "Failed to trigger webhook from updateScanStatus", { error: webhookErr });
    }
  }

  /** Fails an active scan, with the reason shown to the user; false if it had already ended. */
  async markFailedIfActive(scanId: string, reason?: string): Promise<boolean> {
    const res = await this.db.prepare(
      `UPDATE scans SET status = 'failed', completed_at = datetime('now'), failure_reason = ? WHERE id = ? AND ${ACTIVE_STATUS_SQL}`
    ).bind(reason ?? null, scanId).run();
    return ((res?.meta as any)?.changes ?? 0) > 0;
  }

  async getScanStatus(scanId: string): Promise<string | null> {
    const row = await this.db.prepare(
      'SELECT status FROM scans WHERE id = ?'
    ).bind(scanId).first<{ status: string }>();
    return row ? row.status : null;
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

  async getActiveScans(): Promise<any[]> {
    const { results } = await this.db.prepare(`
      SELECT scans.*, users.public_key AS userPublicKey
      FROM scans
      LEFT JOIN users ON scans.user_id = users.id
      WHERE scans.status IN ('queued', 'dispatched', 'paused')
      ORDER BY scans.created_at ASC
    `).all<any>();
    return results || [];
  }

  async getScanConfigByProject(projectId: string, profileName: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT config_json FROM scan_configs WHERE project_id = ? AND name = ?").bind(projectId, profileName).first<{config_json: string}>();
    return row ? row.config_json : null;
  }

  async processFindingsQueueMessages(messages: readonly any[], ctx?: any): Promise<ProcessedEvents> {
    const statements: any[] = [];
    // The status updates that end a scan, each with the webhook it fires if it does. They only
    // apply to a scan that has not ended: its first terminal event wins, so a scan that was
    // failed (by the stalled scan watchdog, say) does not flip to completed, nor fire twice.
    const terminalUpdates: Array<{ statement: number; scanId: string; webhook: { projectId: string; eventType: string; payload: any } | null }> = [];

    const scanIds = Array.from(new Set(messages.map(m => m.body.scanId).filter(Boolean)));
    const scanToProject: Record<string, { projectId: string; targetUrl: string; profile: string }> = {};
    if (scanIds.length > 0) {
      const placeholders = scanIds.map(() => '?').join(',');
      const { results } = await this.db.prepare(
        `SELECT id, project_id, target_url, profile FROM scans WHERE id IN (${placeholders})`
      ).bind(...scanIds).all<any>();
      if (results) {
        results.forEach(r => {
          scanToProject[r.id] = {
            projectId: r.project_id,
            targetUrl: r.target_url,
            profile: r.profile
          };
        });
      }
    }

    // Sequenced runner events carry a stable id (acknowledged delivery): one already stored was
    // processed before (a replay after a coordinator restart, a queue redelivery, or the queue and
    // its D1 fallback both succeeding), and none of its effects may repeat.
    const eventIds = messages.map(m => storedEventId(m.body));
    const alreadyStored = new Set<string>();
    const stableIds = Array.from(new Set(eventIds.filter((id): id is string => id !== undefined)));
    for (let i = 0; i < stableIds.length; i += EVENT_ID_LOOKUP_CHUNK) {
      const chunk = stableIds.slice(i, i + EVENT_ID_LOOKUP_CHUNK);
      const { results } = await this.db.prepare(
        `SELECT id FROM scan_events WHERE id IN (${chunk.map(() => '?').join(',')})`
      ).bind(...chunk).all<{ id: string }>();
      for (const r of results ?? []) alreadyStored.add(r.id);
    }
    const seenInBatch = new Set<string>();

    for (const [index, msg] of messages.entries()) {
      const stableId = eventIds[index];
      if (stableId !== undefined) {
        if (alreadyStored.has(stableId) || seenInBatch.has(stableId)) continue;
        seenInBatch.add(stableId);
      }
      const id = stableId ?? crypto.randomUUID();
      const { scanId, type, payload } = msg.body;
      // scan_events.type and payload are NOT NULL; a runner that omits either must not fail the batch.
      const payloadStr = (typeof payload === 'string' ? payload : JSON.stringify(payload)) ?? 'null';
      const eventType = typeof type === 'string' && type ? type : 'event';
      
      statements.push(
        this.db.prepare(
          `INSERT OR IGNORE INTO scan_events (id, scan_id, type, payload) VALUES (?, ?, ?, ?)`
        ).bind(id, scanId, eventType, payloadStr)
      );

      const projInfo = scanToProject[scanId];
      const projectId = projInfo?.projectId;

      if (payload && payload.type === 'complete') {
        const stats = JSON.stringify(payload.data || {});
        terminalUpdates.push({
          statement: statements.length,
          scanId,
          webhook: projectId ? {
            projectId,
            eventType: 'scan.completed',
            payload: {
              scan_id: scanId,
              status: 'completed',
              target_url: projInfo.targetUrl,
              profile: projInfo.profile,
              summary_stats: payload.data || {}
            }
          } : null,
        });
        statements.push(
          this.db.prepare(
            `UPDATE scans SET status = ?, completed_at = datetime('now'), summary_stats = ? WHERE id = ? AND ${ACTIVE_STATUS_SQL}`
          ).bind('completed', stats, scanId)
        );
      } else if (payload && payload.type === 'checkpoint') {
        const checkpointData = JSON.stringify(payload.data);
        statements.push(
          this.db.prepare(
            `UPDATE scans SET last_checkpoint = ? WHERE id = ?`
          ).bind(checkpointData, scanId)
        );
      } else if (type === 'error' || (payload && payload.type === 'error')) {
        const reason = runnerErrorText(payload) || UNKNOWN_FAILURE;
        terminalUpdates.push({
          statement: statements.length,
          scanId,
          webhook: projectId ? {
            projectId,
            eventType: 'scan.failed',
            payload: {
              scan_id: scanId,
              status: 'failed',
              target_url: projInfo.targetUrl,
              profile: projInfo.profile
            }
          } : null,
        });
        statements.push(
          this.db.prepare(
            `UPDATE scans SET status = ?, completed_at = datetime('now'), failure_reason = ? WHERE id = ? AND ${ACTIVE_STATUS_SQL}`
          ).bind('failed', reason, scanId)
        );
      }

      if (payload && payload.type === 'result' && payload.data && Array.isArray(payload.data.analyzerFindings)) {
        for (const raw of payload.data.analyzerFindings.slice(0, MAX_FINDINGS_PER_EVENT)) {
          const finding = sanitizeRunnerFinding(raw);
          if (!finding) continue;
          // OR IGNORE: a repeated or colliding id must never fail the whole batch, which mixes
          // every tenant's events.
          statements.push(
            this.db.prepare(
              `INSERT OR IGNORE INTO findings (id, scan_id, rule_id, level, message, evidence)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(finding.id, scanId, finding.ruleId, finding.level, finding.message, finding.evidence)
          );
        }
      }
    }

    const results: any[] = statements.length > 0 ? ((await this.db.batch(statements)) ?? []) : [];

    const ended: string[] = [];
    const webhooksToDispatch: Array<{ projectId: string; eventType: string; payload: any }> = [];
    for (const update of terminalUpdates) {
      // Unknown (a driver that reports no change count) counts as changed, as before.
      const changes = results[update.statement]?.meta?.changes;
      if (typeof changes === 'number' && changes === 0) continue;
      ended.push(update.scanId);
      if (update.webhook) webhooksToDispatch.push(update.webhook);
    }

    if (webhooksToDispatch.length > 0) {
      await Promise.all(
        webhooksToDispatch.map(item =>
          dispatchWebhook(this.env, item.projectId, item.eventType, item.payload).catch(err => {
            logError({ env: this.env, executionCtx: ctx }, 'Webhook', `Failed to dispatch webhook for event ${item.eventType}`, { error: err });
          })
        )
      );
    }
    return { ended };
  }

  async saveWAFPatchReport(scanId: string, report: unknown): Promise<void> {
    const reportStr = typeof report === 'string' ? report : JSON.stringify(report);
    await this.db.prepare(
      `UPDATE scans SET waf_patch_report = ? WHERE id = ?`
    ).bind(reportStr, scanId).run();
  }
}
