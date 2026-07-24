import { Env } from '../env';
import { BaseService } from './base';
import { ulid } from 'ulidx';
import {
  getClientIp,
} from '../utils/auth';
import { cleanupExpiredGuests } from '../utils/cleanup';

export interface LoginHistoryMeta {
  ipAddress: string;
  userAgent: string | null;
  cfRay: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  timezone: string | null;
}

export interface IAuthRepository {
  checkUsernameExists(usernameHash: string): Promise<boolean>;
  createUser(username: string, usernameHash: string, hash: string, email: string | null, hashedApiKey: string): Promise<{ id: string; projectId: string }>;
  createGuestUser(username: string, hash: string, hashedApiKey: string): Promise<{ id: string; projectId: string }>;

  createLoginChallenge(token: string, username: string, challenge: string, difficulty: number, expiryStr: string): Promise<void>;
  getAndConsumeChallenge(token: string, expectedUsername?: string): Promise<{ username: string; challenge: string; difficulty: number; expires_at: string } | null>;

  getUserById(userId: string): Promise<any>;
  getUserByUsername(username: string): Promise<any>;
  updateUserApiKey(userId: string, hashedApiKey: string): Promise<void>;
  updateUserPublicKey(userId: string, publicKey: string | null): Promise<void>;
  scheduleUserDeletion(userId: string): Promise<void>;
  cancelUserDeletion(userId: string): Promise<void>;

  updateUserTwoFactorSecret(userId: string, encryptedSecret: string | null, enabled: number): Promise<void>;

  getPasskeysByUserId(userId: string): Promise<any[]>;
  getPasskeyByCredentialId(credentialId: string): Promise<any>;
  savePasskey(credentialId: string, userId: string, publicKeyBase64: string, webauthnUserId: string, counter: number, deviceType: string, backedUp: boolean, transports: string): Promise<void>;
  updatePasskeyCounter(credentialId: string, newCounter: number): Promise<void>;
  deletePasskey(userId: string, credentialId: string): Promise<boolean>;

  updateUserPlan(username: string, plan: string): Promise<number>;

  linkGithubUser(userId: string, githubId: string): Promise<boolean>;
  getUserByGithubId(githubId: string): Promise<any>;
  linkGitlabUser(userId: string, gitlabId: string): Promise<boolean>;
  getUserByGitlabId(gitlabId: string): Promise<any>;
  getUserByEmail(email: string): Promise<any>;
  createGithubUser(username: string, usernameHash: string, hash: string, email: string | null, hashedApiKey: string, githubId: string): Promise<{ id: string; projectId: string }>;
  createGitlabUser(username: string, usernameHash: string, hash: string, email: string | null, hashedApiKey: string, gitlabId: string): Promise<{ id: string; projectId: string }>;

  // Rate limiting & login tracking
  checkIpRateLimit(key: string, maxAttempts: number, windowSeconds: number): Promise<{ limited: boolean }>;
  checkLoginRateLimit(username: string): Promise<{ locked: boolean; retryAfter?: string }>;
  recordFailedLogin(username: string): Promise<void>;
  resetLoginAttempts(username: string): Promise<void>;
  recordLoginHistory(userId: string, status: 'success' | 'failed_password' | 'failed_2fa' | 'locked', authMethod: 'password' | 'github' | 'gitlab', twoFactorActive: boolean, meta: LoginHistoryMeta): Promise<void>;
  cleanupExpiredGuests(): Promise<void>;
  getUserCount(): Promise<number>;
  checkInvitationTokenValid(token: string): Promise<boolean>;
  verifyApiKey(hashedToken: string, plainToken: string): Promise<string | null>;
  getUserDeleteRequestedAt(userId: string): Promise<string | null>;
}

export class AuthRepository extends BaseService implements IAuthRepository {
  constructor(env: Env) {
    super(env);
  }


  async checkUsernameExists(usernameHash: string): Promise<boolean> {
    const existing = await this.db.prepare('SELECT username_hash FROM username_registry WHERE username_hash = ?')
      .bind(usernameHash).first<{ username_hash: string }>();
    return !!existing;
  }

  async createUser(username: string, usernameHash: string, hash: string, email: string | null, hashedApiKey: string): Promise<{ id: string; projectId: string }> {
    const id = ulid();
    const projectId = ulid();
    await this.db.batch([
      this.db.prepare('INSERT INTO username_registry (username_hash) VALUES (?)').bind(usernameHash),
      this.db.prepare("INSERT INTO users (id, username, password_hash, api_key, email, plan) VALUES (?, ?, ?, ?, ?, 'Free')").bind(id, username, hash, hashedApiKey, email),
      this.db.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')").bind(projectId),
      this.db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").bind(projectId, id),
      this.db.prepare("INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, 'owner')").bind(projectId, id)
    ]);
    return { id, projectId };
  }

  async createGuestUser(username: string, hash: string, hashedApiKey: string): Promise<{ id: string; projectId: string }> {
    const id = ulid();
    const projectId = ulid();
    await this.db.batch([
      this.db.prepare("INSERT INTO users (id, username, password_hash, api_key, is_guest, expires_at, plan) VALUES (?, ?, ?, ?, 1, datetime('now', '+1 day'), 'Free')").bind(id, username, hash, hashedApiKey),
      this.db.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')").bind(projectId),
      this.db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").bind(projectId, id),
      this.db.prepare("INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, 'owner')").bind(projectId, id)
    ]);
    return { id, projectId };
  }

  async createLoginChallenge(token: string, username: string, challenge: string, difficulty: number, expiryStr: string): Promise<void> {
    await this.db.prepare('INSERT INTO login_challenges (token, username, challenge, difficulty, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(token, username, challenge, difficulty, expiryStr).run();
  }

  async getAndConsumeChallenge(token: string, expectedUsername?: string): Promise<{ username: string; challenge: string; difficulty: number; expires_at: string } | null> {
    let query = 'SELECT username, challenge, difficulty, expires_at FROM login_challenges WHERE token = ?';
    let bindings: any[] = [token];
    if (expectedUsername) {
      query += ' AND username = ?';
      bindings.push(expectedUsername);
    }
    const challengeRow = await this.db.prepare(query).bind(...bindings).first<{ username: string; challenge: string; difficulty: number; expires_at: string }>();
    if (challengeRow) {
      await this.db.prepare('DELETE FROM login_challenges WHERE token = ?').bind(token).run();
    }
    return challengeRow || null;
  }

  async getUserById(userId: string): Promise<any> {
    return await this.db.prepare('SELECT username, api_key, public_key, is_guest, delete_requested_at, two_factor_enabled, plan, github_id, gitlab_id, is_interactive FROM users WHERE id = ?')
      .bind(userId).first();
  }

  async getUserByUsername(username: string): Promise<any> {
    return await this.db.prepare('SELECT id, password_hash, two_factor_enabled, two_factor_secret, is_interactive FROM users WHERE username = ?')
      .bind(username).first();
  }

  async updateUserApiKey(userId: string, hashedApiKey: string): Promise<void> {
    await this.db.prepare('UPDATE users SET api_key = ? WHERE id = ?').bind(hashedApiKey, userId).run();
  }

  async updateUserPublicKey(userId: string, publicKey: string | null): Promise<void> {
    await this.db.prepare('UPDATE users SET public_key = ? WHERE id = ?').bind(publicKey, userId).run();
  }

  async scheduleUserDeletion(userId: string): Promise<void> {
    await this.db.prepare("UPDATE users SET delete_requested_at = datetime('now') WHERE id = ?").bind(userId).run();
    await this.db.prepare(`
      UPDATE scans
      SET status = 'failed', completed_at = datetime('now')
      WHERE (user_id = ? OR project_id IN (
        SELECT pm.project_id FROM project_members pm
        WHERE pm.user_id = ? AND pm.role = 'owner'
      )) AND completed_at IS NULL
    `).bind(userId, userId).run();
  }

  async cancelUserDeletion(userId: string): Promise<void> {
    await this.db.prepare('UPDATE users SET delete_requested_at = NULL WHERE id = ?').bind(userId).run();
  }

  async updateUserTwoFactorSecret(userId: string, encryptedSecret: string | null, enabled: number): Promise<void> {
    await this.db.prepare('UPDATE users SET two_factor_secret = ?, two_factor_enabled = ? WHERE id = ?').bind(encryptedSecret, enabled, userId).run();
  }

  async getPasskeysByUserId(userId: string): Promise<any[]> {
    const { results } = await this.db.prepare('SELECT credential_id, transports, device_type, created_at, credential_id as id FROM passkeys WHERE user_id = ?').bind(userId).all();
    return results;
  }

  async getPasskeyByCredentialId(credentialId: string): Promise<any> {
    return await this.db.prepare('SELECT user_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?').bind(credentialId).first();
  }

  async savePasskey(credentialId: string, userId: string, publicKeyBase64: string, webauthnUserId: string, counter: number, deviceType: string, backedUp: boolean, transports: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO passkeys (credential_id, user_id, public_key, webauthn_user_id, counter, device_type, backed_up, transports)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(credentialId, userId, publicKeyBase64, webauthnUserId, counter, deviceType, backedUp ? 1 : 0, transports).run();
  }

  async updatePasskeyCounter(credentialId: string, newCounter: number): Promise<void> {
    await this.db.prepare('UPDATE passkeys SET counter = ? WHERE credential_id = ?').bind(newCounter, credentialId).run();
  }

  async deletePasskey(userId: string, credentialId: string): Promise<boolean> {
    const { success } = await this.db.prepare('DELETE FROM passkeys WHERE credential_id = ? AND user_id = ?').bind(credentialId, userId).run();
    return success;
  }

  async updateUserPlan(username: string, plan: string): Promise<number> {
    const result = await this.db.prepare('UPDATE users SET plan = ? WHERE username = ?').bind(plan, username).run();
    return result.meta.changes;
  }

  async linkGithubUser(userId: string, githubId: string): Promise<boolean> {
    const existingLink = await this.db.prepare('SELECT id FROM users WHERE github_id = ?').bind(githubId).first<{ id: string }>();
    if (existingLink && existingLink.id !== userId) return false;
    await this.db.prepare('UPDATE users SET github_id = ? WHERE id = ?').bind(githubId, userId).run();
    return true;
  }

  async getUserByGithubId(githubId: string): Promise<any> {
    return await this.db.prepare('SELECT id, two_factor_enabled, is_interactive FROM users WHERE github_id = ?').bind(githubId).first();
  }

  async linkGitlabUser(userId: string, gitlabId: string): Promise<boolean> {
    const existingLink = await this.db.prepare('SELECT id FROM users WHERE gitlab_id = ?').bind(gitlabId).first<{ id: string }>();
    if (existingLink && existingLink.id !== userId) return false;
    await this.db.prepare('UPDATE users SET gitlab_id = ? WHERE id = ?').bind(gitlabId, userId).run();
    return true;
  }

  async getUserByGitlabId(gitlabId: string): Promise<any> {
    return await this.db.prepare('SELECT id, two_factor_enabled, is_interactive FROM users WHERE gitlab_id = ?').bind(gitlabId).first();
  }

  async getUserByEmail(email: string): Promise<any> {
    return await this.db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  }

  async createGithubUser(username: string, usernameHash: string, hash: string, email: string | null, hashedApiKey: string, githubId: string): Promise<{ id: string; projectId: string }> {
    const userId = ulid();
    const projectId = ulid();
    await this.db.batch([
      this.db.prepare('INSERT INTO username_registry (username_hash) VALUES (?)').bind(usernameHash),
      this.db.prepare("INSERT INTO users (id, username, password_hash, api_key, email, github_id, plan) VALUES (?, ?, ?, ?, ?, ?, 'Free')").bind(userId, username, hash, hashedApiKey, email, githubId),
      this.db.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')").bind(projectId),
      this.db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").bind(projectId, userId),
      this.db.prepare("INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, 'owner')").bind(projectId, userId)
    ]);
    return { id: userId, projectId };
  }

  async createGitlabUser(username: string, usernameHash: string, hash: string, email: string | null, hashedApiKey: string, gitlabId: string): Promise<{ id: string; projectId: string }> {
    const userId = ulid();
    const projectId = ulid();
    await this.db.batch([
      this.db.prepare('INSERT INTO username_registry (username_hash) VALUES (?)').bind(usernameHash),
      this.db.prepare("INSERT INTO users (id, username, password_hash, api_key, email, gitlab_id, plan) VALUES (?, ?, ?, ?, ?, ?, 'Free')").bind(userId, username, hash, hashedApiKey, email, gitlabId),
      this.db.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')").bind(projectId),
      this.db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')").bind(projectId, userId),
      this.db.prepare("INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, 'owner')").bind(projectId, userId)
    ]);
    return { id: userId, projectId };
  }

  async checkIpRateLimit(key: string, maxAttempts: number, windowSeconds: number): Promise<{ limited: boolean }> {
    const now = new Date();
    const resetTime = new Date(now.getTime() + windowSeconds * 1000);
    const nowStr = now.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

    // Clean up expired rate limits probabilistically (e.g., 1% of requests)
    if (Math.random() < 0.01) {
      await this.db.prepare("DELETE FROM rate_limits WHERE reset_at < datetime('now')").run();
    }

    const row = await this.db
      .prepare('SELECT attempts, reset_at FROM rate_limits WHERE key = ?')
      .bind(key)
      .first<{ attempts: number; reset_at: string }>();

    if (!row) {
      const resetAtStr = resetTime.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      await this.db
        .prepare('INSERT INTO rate_limits (key, attempts, reset_at) VALUES (?, 1, ?)')
        .bind(key, resetAtStr)
        .run();
      return { limited: false };
    }

    const resetAt = new Date(row.reset_at + 'Z');
    if (resetAt < now) {
      const resetAtStr = resetTime.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
      await this.db
        .prepare('UPDATE rate_limits SET attempts = 1, reset_at = ? WHERE key = ?')
        .bind(resetAtStr, key)
        .run();
      return { limited: false };
    }

    if (row.attempts >= maxAttempts) {
      return { limited: true };
    }

    await this.db
      .prepare('UPDATE rate_limits SET attempts = attempts + 1 WHERE key = ?')
      .bind(key)
      .run();
    
    return { limited: false };
  }

  async checkLoginRateLimit(username: string): Promise<{ locked: boolean; retryAfter?: string }> {
    const row = await this.db
      .prepare('SELECT failed_count, locked_until FROM login_attempts WHERE username = ?')
      .bind(username)
      .first<{ failed_count: number; locked_until: string | null }>();

    if (!row) return { locked: false };

    if (row.locked_until) {
      const lockedUntil = new Date(row.locked_until + 'Z'); // D1 stores UTC without Z suffix
      if (lockedUntil > new Date()) {
        return { locked: true, retryAfter: row.locked_until };
      }
      // Lock has expired — reset the counter
      await this.db
        .prepare('UPDATE login_attempts SET failed_count = 0, locked_until = NULL WHERE username = ?')
        .bind(username)
        .run();
    }

    return { locked: false };
  }

  async recordFailedLogin(username: string): Promise<void> {
    const LOCKOUT_MINUTES = 15;
    const lockDate = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    const lockedUntil = lockDate.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

    await this.db
      .prepare(
        "INSERT INTO login_attempts (username, failed_count, locked_until) " +
        "VALUES (?1, 1, NULL) " +
        "ON CONFLICT(username) DO UPDATE SET " +
          "failed_count = failed_count + 1, " +
          "locked_until = CASE WHEN failed_count + 1 >= 5 THEN ?2 ELSE NULL END"
      )
      .bind(username, lockedUntil)
      .run();
  }

  async resetLoginAttempts(username: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM login_attempts WHERE username = ?')
      .bind(username)
      .run();
  }

  async recordLoginHistory(
    userId: string,
    status: 'success' | 'failed_password' | 'failed_2fa' | 'locked',
    authMethod: 'password' | 'github' | 'gitlab',
    twoFactorActive: boolean,
    meta: LoginHistoryMeta
  ): Promise<void> {
    const id = ulid();
    try {
      await this.db.prepare(`
        INSERT INTO user_login_history (
          id, user_id, status, ip_address, country, city, region, timezone, cf_ray, user_agent, auth_method, two_factor_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, userId, status,
        meta.ipAddress, meta.country, meta.city, meta.region, meta.timezone,
        meta.cfRay, meta.userAgent, authMethod, twoFactorActive ? 1 : 0
      ).run();
    } catch (err) {
      console.error('Failed to record login history:', err);
    }
  }

  async cleanupExpiredGuests(): Promise<void> {
    await cleanupExpiredGuests(this.db);
  }

  async verifyApiKey(hashedToken: string, plainToken: string): Promise<string | null> {
    let user = await this.db.prepare('SELECT id FROM users WHERE api_key = ?')
      .bind(hashedToken)
      .first<{ id: string }>();

    if (!user) {
      user = await this.db.prepare('SELECT id FROM users WHERE api_key = ?')
        .bind(plainToken)
        .first<{ id: string }>();

      if (user) {
        try {
          await this.db.prepare('UPDATE users SET api_key = ? WHERE id = ?')
            .bind(hashedToken, user.id)
            .run();
        } catch {
          // Ignore
        }
      }
    }
    return user ? user.id : null;
  }

  async getUserDeleteRequestedAt(userId: string): Promise<string | null> {
    const user = await this.db.prepare('SELECT delete_requested_at FROM users WHERE id = ?')
      .bind(userId)
      .first<{ delete_requested_at: string | null }>();
    return user ? user.delete_requested_at : null;
  }

  async getUserCount(): Promise<number> {
    const res = await this.db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
    return res ? res.count : 0;
  }

  async checkInvitationTokenValid(token: string): Promise<boolean> {
    const inv = await this.db.prepare(
      "SELECT id FROM project_invitations WHERE token = ? AND status = 'Pending' AND strftime('%s', expires_at) > strftime('%s', 'now')"
    ).bind(token).first<{ id: string }>();
    return !!inv;
  }
}
