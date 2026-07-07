import { Env } from '../env';
import { BaseService } from './base';

export interface IMiscRepository {
  getAnonymousUsage(ip: string): Promise<number>;
  incrementAnonymousUsage(ip: string): Promise<void>;
  getUserPublicKey(userId: string): Promise<string | null>;
}

export class MiscRepository extends BaseService implements IMiscRepository {
  constructor(env: Env) {
    super(env);
  }

  async getAnonymousUsage(ip: string): Promise<number> {
    const usage = await this.db.prepare('SELECT json_count FROM anonymous_usage WHERE ip = ?')
      .bind(ip)
      .first<{ json_count: number }>();
    return usage ? usage.json_count : 0;
  }

  async incrementAnonymousUsage(ip: string): Promise<void> {
    await this.db.prepare(
      `INSERT INTO anonymous_usage (ip, json_count) VALUES (?, 1)
       ON CONFLICT(ip) DO UPDATE SET json_count = json_count + 1`
    ).bind(ip).run();
  }

  async getUserPublicKey(userId: string): Promise<string | null> {
    const user = await this.db.prepare('SELECT public_key FROM users WHERE id = ?')
      .bind(userId)
      .first<{ public_key: string | null }>();
    return user ? user.public_key : null;
  }
}
