// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { BaseService } from './base';
import { OOB_PENDING_DAYS } from './scans';

export interface ICleanupRepository {
  cleanupSecurityTables(): Promise<{ challenges: number; wsTickets: number; rateLimits: number; loginHistory: number; auditLogs: number; oobPending: number }>;
  getExpiredGuestUsers(): Promise<{ id: string; username: string }[]>;
  getProjectsOwnedByUser(userId: string): Promise<string[]>;
  deleteGuestUserData(userId: string, projectIds: string[], username: string): Promise<void>;
  
  getExpiredScheduledDeletions(): Promise<{ id: string; username: string }[]>;
  getProjectsOwnedByUsers(userIds: string[]): Promise<string[]>;
  getScanReportUrls(userIds: string[], projectIds: string[]): Promise<string[]>;
  getUserApiKeys(userIds: string[]): Promise<string[]>;
  deleteUsersData(userIds: string[], projectIds: string[], usernames: string[]): Promise<void>;
}

export const reportKeyForScan = (scanId: string) => `reports/${scanId}.enc`;

export class CleanupRepository extends BaseService<Env | { DB: D1Database }> implements ICleanupRepository {
  constructor(env: Env | { DB: D1Database }) {
    super(env);
  }

  async cleanupSecurityTables(): Promise<{ challenges: number; wsTickets: number; rateLimits: number; loginHistory: number; auditLogs: number; oobPending: number }> {
    const [challengesRes, usedPasskeyRes, wsTicketsRes, rateLimitsRes, historyRes, auditRes, oobPendingRes] = await Promise.all([
      this.db.prepare("DELETE FROM login_challenges WHERE expires_at < datetime('now')").run(),
      // Login challenges expire after 5 minutes, so a day-old spent marker can never matter again.
      this.db.prepare("DELETE FROM used_passkey_challenges WHERE used_at < datetime('now', '-1 day')").run(),
      // Event stream tickets nobody used: refused once expired, so nothing reads them any more.
      this.db.prepare("DELETE FROM ws_tickets WHERE expires_at < CAST(strftime('%s', 'now') AS INTEGER)").run(),
      this.db.prepare("DELETE FROM rate_limits WHERE reset_at < datetime('now')").run(),
      this.db.prepare("DELETE FROM user_login_history WHERE created_at < datetime('now', '-90 days')").run(),
      this.db.prepare("DELETE FROM audit_logs WHERE timestamp < datetime('now', '-45 days')").run(),
      // OOB tokens past the window a late callback is still reported in (recordLateOobCallback).
      this.db.prepare(`DELETE FROM oob_pending WHERE created_at < datetime('now', '-${OOB_PENDING_DAYS} days')`).run(),
    ]);

    return {
      challenges: (challengesRes.meta?.changes || 0) + (usedPasskeyRes.meta?.changes || 0),
      wsTickets: wsTicketsRes.meta?.changes || 0,
      rateLimits: rateLimitsRes.meta?.changes || 0,
      loginHistory: historyRes.meta?.changes || 0,
      auditLogs: auditRes.meta?.changes || 0,
      oobPending: oobPendingRes.meta?.changes || 0,
    };
  }

  async getExpiredGuestUsers(): Promise<{ id: string; username: string }[]> {
    const res = await this.db.prepare(
      "SELECT id, username FROM users WHERE is_guest = 1 AND expires_at < datetime('now') LIMIT 20"
    ).all<{ id: string; username: string }>();
    return res.results || [];
  }

  async getProjectsOwnedByUser(userId: string): Promise<string[]> {
    const res = await this.db.prepare(
      "SELECT project_id FROM project_members WHERE user_id = ? AND role = 'owner'"
    ).bind(userId).all<{ project_id: string }>();
    return (res.results || []).map(p => p.project_id);
  }

  async deleteGuestUserData(userId: string, projectIds: string[], username: string): Promise<void> {
    const batchStatements = [];

    // Clean up project-related data
    for (const projectId of projectIds) {
      batchStatements.push(this.db.prepare("DELETE FROM scans WHERE project_id = ?").bind(projectId));
      batchStatements.push(this.db.prepare("DELETE FROM scan_configs WHERE project_id = ?").bind(projectId));
      batchStatements.push(this.db.prepare("DELETE FROM project_members WHERE project_id = ?").bind(projectId));
      batchStatements.push(this.db.prepare("DELETE FROM projects WHERE id = ?").bind(projectId));
    }

    // Clean up user-related data
    batchStatements.push(this.db.prepare("DELETE FROM scans WHERE user_id = ?").bind(userId));
    batchStatements.push(this.db.prepare("DELETE FROM project_members WHERE user_id = ?").bind(userId));
    batchStatements.push(this.db.prepare("DELETE FROM runners WHERE user_id = ?").bind(userId));
    batchStatements.push(this.db.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username));
    batchStatements.push(this.db.prepare("DELETE FROM users WHERE id = ?").bind(userId));

    if (batchStatements.length > 0) {
      await this.db.batch(batchStatements);
    }
  }

  async getExpiredScheduledDeletions(): Promise<{ id: string; username: string }[]> {
    const res = await this.db.prepare(
      "SELECT id, username FROM users WHERE delete_requested_at IS NOT NULL AND delete_requested_at < datetime('now', '-7 days')"
    ).all<{ id: string; username: string }>();
    return res.results || [];
  }

  async getProjectsOwnedByUsers(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const placeholders = userIds.map(() => '?').join(',');
    const res = await this.db.prepare(
      `SELECT project_id FROM project_members WHERE role = 'owner' AND user_id IN (${placeholders})`
    ).bind(...userIds).all<{ project_id: string }>();
    return res.results ? res.results.map(p => p.project_id) : [];
  }

  async getScanReportUrls(userIds: string[], projectIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const userPlaceholders = userIds.map(() => '?').join(',');
    let scansQuery = `SELECT id, report_url FROM scans WHERE user_id IN (${userPlaceholders})`;
    const scansParams: any[] = [...userIds];

    if (projectIds.length > 0) {
      const projPlaceholders = projectIds.map(() => '?').join(',');
      scansQuery += ` OR project_id IN (${projPlaceholders})`;
      scansParams.push(...projectIds);
    }

    const res = await this.db.prepare(scansQuery).bind(...scansParams).all<{ id: string; report_url: string | null }>();
    // The R2 key is rebuilt from the trusted scan id; a stored value that is not exactly that
    // scan's own report key is never handed to STORAGE.delete().
    return (res.results || [])
      .filter(s => !!s.report_url && s.report_url === reportKeyForScan(s.id))
      .map(s => reportKeyForScan(s.id));
  }

  async getUserApiKeys(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const placeholders = userIds.map(() => '?').join(',');
    const res = await this.db.prepare(
      `SELECT api_key FROM users WHERE id IN (${placeholders}) AND api_key IS NOT NULL`
    ).bind(...userIds).all<{ api_key: string }>();
    return res.results ? res.results.map(r => r.api_key) : [];
  }

  async deleteUsersData(userIds: string[], projectIds: string[], usernames: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const queries = [];
    const userPlaceholders = userIds.map(() => '?').join(',');
    const usernamePlaceholders = usernames.map(() => '?').join(',');

    if (projectIds.length > 0) {
      const projPlaceholders = projectIds.map(() => '?').join(',');
      queries.push(
        this.db.prepare(`DELETE FROM scans WHERE user_id IN (${userPlaceholders}) OR project_id IN (${projPlaceholders})`).bind(...userIds, ...projectIds),
        this.db.prepare(`DELETE FROM scan_configs WHERE project_id IN (${projPlaceholders})`).bind(...projectIds),
        this.db.prepare(`DELETE FROM project_members WHERE project_id IN (${projPlaceholders})`).bind(...projectIds),
        this.db.prepare(`DELETE FROM projects WHERE id IN (${projPlaceholders})`).bind(...projectIds)
      );
    } else {
      queries.push(
        this.db.prepare(`DELETE FROM scans WHERE user_id IN (${userPlaceholders})`).bind(...userIds)
      );
    }

    queries.push(
      this.db.prepare(`DELETE FROM project_members WHERE user_id IN (${userPlaceholders})`).bind(...userIds),
      this.db.prepare(`DELETE FROM runners WHERE user_id IN (${userPlaceholders})`).bind(...userIds),
      this.db.prepare(`DELETE FROM login_attempts WHERE username IN (${usernamePlaceholders})`).bind(...usernames),
      this.db.prepare(`DELETE FROM users WHERE id IN (${userPlaceholders})`).bind(...userIds)
    );

    await this.db.batch(queries);
  }
}
