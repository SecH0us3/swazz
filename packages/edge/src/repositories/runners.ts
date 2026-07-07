import { Env } from '../env';
import { BaseService } from './base';
import { getDeleteRequestedAt } from '../utils/auth';

export interface IRunnersRepository {
  getUserByPublicKey(publicKey: string): Promise<{ id: string } | null>;
  getUserByApiKey(apiKeyHash: string): Promise<{ id: string } | null>;
  updateUserApiKey(userId: string, apiKeyHash: string): Promise<void>;
  getDeleteRequestedAt(userId: string): Promise<string | null>;
  getUserPublicKey(userId: string): Promise<string | null>;
  createScanRecord(runId: string, projectId: string, targetUrl: string, profile: string, status: string, userId: string | null): Promise<void>;
  getScanDetails(scanId: string): Promise<{ project_id: string | null; user_id: string | null } | null>;
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
    return getDeleteRequestedAt(this.db, userId);
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
}
