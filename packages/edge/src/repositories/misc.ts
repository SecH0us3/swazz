import { Env } from '../env';
import { BaseService } from './base';

export interface IMiscRepository {
  getAnonymousUsage(ip: string): Promise<number>;
  incrementAnonymousUsage(ip: string): Promise<void>;
  getUserPublicKey(userId: string): Promise<string | null>;
  incrementGlobalScanCount(yyMm: string): Promise<void>;
  getGlobalScanCount(): Promise<{ total: number; monthly: Record<string, number> }>;
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

  async incrementGlobalScanCount(yyMm: string): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO global_telemetry (key, value) VALUES ('total_scans', 1)
         ON CONFLICT(key) DO UPDATE SET value = value + 1`
      ),
      this.db.prepare(
        `INSERT INTO monthly_telemetry (yy_mm, value) VALUES (?, 1)
         ON CONFLICT(yy_mm) DO UPDATE SET value = value + 1`
      ).bind(yyMm)
    ]);
  }

  async getGlobalScanCount(): Promise<{ total: number; monthly: Record<string, number> }> {
    const totalRow = await this.db.prepare("SELECT value FROM global_telemetry WHERE key = 'total_scans'")
      .first<{ value: number }>();
    const total = totalRow ? totalRow.value : 0;

    const monthlyRows = await this.db.prepare("SELECT yy_mm, value FROM monthly_telemetry ORDER BY yy_mm DESC")
      .all<{ yy_mm: string; value: number }>();
    
    const monthly: Record<string, number> = {};
    if (monthlyRows.results) {
      for (const row of monthlyRows.results) {
        monthly[row.yy_mm] = row.value;
      }
    }

    return { total, monthly };
  }
}
