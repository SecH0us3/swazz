import { Env } from '../env';
import { BaseService } from './base';
import { ulid } from 'ulidx';

export interface IAuditLogRepository {
  createAuditLog(
    projectId: string,
    userId: string | null,
    action: string,
    label: string,
    source: string,
    details: string | null,
    ip: string | null
  ): Promise<void>;
}

export class AuditLogRepository extends BaseService implements IAuditLogRepository {
  constructor(env: Env) {
    super(env);
  }

  async createAuditLog(
    projectId: string,
    userId: string | null,
    action: string,
    label: string,
    source: string,
    details: string | null,
    ip: string | null
  ): Promise<void> {
    const [userRow, memberRow] = await Promise.all([
      userId
        ? this.db.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first<{ username: string }>()
        : Promise.resolve(null),
      userId && projectId
        ? this.db
            .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
            .bind(projectId, userId)
            .first<{ role: string }>()
        : Promise.resolve(null),
    ]);

    await this.db
      .prepare(
        `INSERT INTO audit_logs
           (id, project_id, user_id, actor_username, actor_role, action, action_label, source, details, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        ulid(),
        projectId,
        userId ?? null,
        userRow?.username ?? null,
        memberRow?.role ?? null,
        action,
        label,
        source,
        details,
        ip ?? null
      )
      .run();
  }
}
