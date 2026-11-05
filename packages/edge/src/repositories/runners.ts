// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { BaseService } from './base';

export interface IRunnersRepository {
  getUserByPublicKey(publicKey: string): Promise<{ id: string } | null>;
  getUserByApiKey(apiKeyHash: string): Promise<{ id: string } | null>;
  updateUserApiKey(userId: string, apiKeyHash: string): Promise<void>;
  getDeleteRequestedAt(userId: string): Promise<string | null>;
  getUserPublicKey(userId: string): Promise<string | null>;
  createScanRecord(runId: string, projectId: string, targetUrl: string, profile: string, status: string, userId: string | null): Promise<void>;
  getScanDetails(scanId: string): Promise<{ project_id: string | null; user_id: string | null } | null>;
  createStreamTicket(ticketHash: string, userId: string, runId: string, expiresAt: number, maxLive: number): Promise<boolean>;
  consumeStreamTicket(ticketHash: string): Promise<StreamTicket | null>;
}

/** A stored one-time ticket for a scan's event stream; `expiresAt` is in Unix seconds. */
export interface StreamTicket {
  userId: string;
  runId: string;
  expiresAt: number;
}

export class RunnersRepository extends BaseService implements IRunnersRepository {
  constructor(env: Env) {
    super(env);
  }

  async getUserByPublicKey(publicKey: string): Promise<{ id: string } | null> {
    const user = await this.db.prepare('SELECT id FROM users WHERE public_key = ?')
      .bind(publicKey)
      .first<{ id: string }>();
    return user || null;
  }

  async getUserByApiKey(apiKeyHash: string): Promise<{ id: string } | null> {
    const user = await this.db.prepare('SELECT id FROM users WHERE api_key = ?')
      .bind(apiKeyHash)
      .first<{ id: string }>();
    return user || null;
  }

  async updateUserApiKey(userId: string, apiKeyHash: string): Promise<void> {
    await this.db.prepare('UPDATE users SET api_key = ? WHERE id = ?')
      .bind(apiKeyHash, userId)
      .run();
  }

  async getDeleteRequestedAt(userId: string): Promise<string | null> {
    const user = await this.db.prepare('SELECT delete_requested_at FROM users WHERE id = ?')
      .bind(userId)
      .first<{ delete_requested_at: string | null }>();
    return user ? user.delete_requested_at : null;
  }

  async getUserPublicKey(userId: string): Promise<string | null> {
    const user = await this.db.prepare('SELECT public_key FROM users WHERE id = ?')
      .bind(userId)
      .first<{ public_key: string | null }>();
    return user ? user.public_key : null;
  }

  async createScanRecord(
    runId: string,
    projectId: string,
    targetUrl: string,
    profile: string,
    status: string,
    userId: string | null
  ): Promise<void> {
    await this.db.prepare(
      `INSERT INTO scans (id, project_id, target_url, profile, status, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(runId, projectId, targetUrl, profile, status, userId)
      .run();
  }

  async getScanDetails(scanId: string): Promise<{ project_id: string | null; user_id: string | null } | null> {
    const scan = await this.db.prepare('SELECT project_id, user_id FROM scans WHERE id = ?')
      .bind(scanId)
      .first<{ project_id: string | null; user_id: string | null }>();
    return scan || null;
  }

  /**
   * Stores a ticket unless the user already holds `maxLive` unexpired ones; false if refused. The
   * user's expired tickets go first, so no user ever has more than `maxLive` rows here.
   */
  async createStreamTicket(ticketHash: string, userId: string, runId: string, expiresAt: number, maxLive: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    const [, inserted] = await this.db.batch([
      this.db.prepare('DELETE FROM ws_tickets WHERE user_id = ? AND expires_at <= ?').bind(userId, now),
      this.db.prepare(
        `INSERT INTO ws_tickets (ticket_hash, user_id, run_id, expires_at)
         SELECT ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM ws_tickets WHERE user_id = ?) < ?`
      ).bind(ticketHash, userId, runId, expiresAt, userId, maxLive),
    ]);
    return (inserted.meta?.changes ?? 0) > 0;
  }

  /** Deletes the ticket and returns what it was for: a single statement, so it can be used once. */
  async consumeStreamTicket(ticketHash: string): Promise<StreamTicket | null> {
    const row = await this.db.prepare('DELETE FROM ws_tickets WHERE ticket_hash = ? RETURNING user_id, run_id, expires_at')
      .bind(ticketHash)
      .first<{ user_id: string; run_id: string; expires_at: number }>();
    return row ? { userId: row.user_id, runId: row.run_id, expiresAt: Number(row.expires_at) } : null;
  }
}
