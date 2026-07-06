import { Env } from '../env';
import { Project } from '../types';
import { ulid } from 'ulidx';
import { BaseService } from './base';

export interface IProjectRepository {
  getProjects(userId: string | null): Promise<Project[]>;
  createProject(userId: string, body: any): Promise<{ id: string }>;
  getProjectConfig(projectId: string): Promise<{ config: any; cron_schedule: string | null; last_run_at: string | null }>;
  saveProjectConfig(projectId: string, config: any): Promise<void>;
  updateProjectSchedule(projectId: string, cronSchedule: string | null): Promise<{ oldSchedule: string | null }>;
  updateProjectSettings(projectId: string, body: any): Promise<{ beforeDiff: Record<string, any>; afterDiff: Record<string, any>; updated: boolean }>;
  deleteProject(projectId: string): Promise<void>;
  getProjectAnalytics(projectId: string, userId: string | null, period: string): Promise<any>;
  checkUserIsMember(projectId: string, userId: string): Promise<boolean>;
  getUserLoginHistory(userId: string, page: number, limit: number): Promise<{ history: any[]; pagination: any }>;
  getProjectAuditLogs(projectId: string, page: number, limit: number, search: string, source: string, action: string): Promise<{ logs: any[]; pagination: any }>;
}

export class ProjectRepository extends BaseService implements IProjectRepository {
  constructor(env: Env) {
    super(env);
  }

  async getProjects(userId: string | null): Promise<Project[]> {
    if (userId !== null && typeof userId !== 'string') {
      throw new TypeError('userId must be a string or null');
    }
    if (userId) {
      let { results } = await this.db.prepare(`
        SELECT p.* 
        FROM projects p 
        JOIN project_members m ON p.id = m.project_id 
        WHERE m.user_id = ? 
        ORDER BY p.created_at DESC
      `).bind(userId).all<Project>();
  
      // Auto-create a default project if the user has none
      if (!results || results.length === 0) {
        const projectId = ulid();
        await this.db.batch([
          this.db.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
            .bind(projectId),
          this.db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
            .bind(projectId, userId),
          this.db.prepare("INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, 'owner')")
            .bind(projectId, userId)
        ]);
        
        const newProject = await this.db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
        results = newProject ? [newProject] : [];
      }
  
      return results;
    }
    
    // Fallback: list all
    const { results } = await this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all<Project>();
    return results;
  }

  async createProject(userId: string, body: any): Promise<{ id: string }> {
    if (typeof userId !== 'string') {
      throw new TypeError('userId must be a string');
    }
    if (!body || typeof body !== 'object') {
      throw new TypeError('body must be an object');
    }
    if (typeof body.name !== 'string') {
      throw new TypeError('body.name must be a string');
    }
    const id = ulid();
    
    await this.db.batch([
      this.db.prepare('INSERT INTO projects (id, name, description, url_mappings, ai_prompts, propose_fixes, custom_cli_command) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, body.name, body.description || '', body.url_mappings || null, body.ai_prompts || null, body.propose_fixes ? 1 : 0, body.custom_cli_command || null),
      this.db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
        .bind(id, userId, 'owner'),
      this.db.prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)')
        .bind(id, userId, 'owner')
    ]);

    return { id };
  }

  async getProjectConfig(projectId: string): Promise<{ config: any; cron_schedule: string | null; last_run_at: string | null }> {
    if (typeof projectId !== 'string') {
      throw new TypeError('projectId must be a string');
    }
    const result = await this.db.prepare(
      "SELECT config_json, cron_schedule, last_run_at FROM scan_configs WHERE project_id = ? AND name = 'default'"
    )
    .bind(projectId)
    .first<{ config_json: string; cron_schedule: string | null; last_run_at: string | null }>();
  
    if (!result) {
      return { config: null, cron_schedule: null, last_run_at: null };
    }

    let config = null;
    try {
      config = JSON.parse(result.config_json);
    } catch (err) {
      console.error('Failed to parse config_json for project ' + projectId + ':', err);
    }

    return {
      config,
      cron_schedule: result.cron_schedule,
      last_run_at: result.last_run_at
    };
  }

  async saveProjectConfig(projectId: string, config: any): Promise<void> {
    const configJson = JSON.stringify(config);
    const id = ulid();
  
    // Fetch current cron_schedule and last_run_at to preserve them
    const existing = await this.db.prepare(
      "SELECT cron_schedule, last_run_at FROM scan_configs WHERE project_id = ? AND name = 'default'"
    ).bind(projectId).first<{ cron_schedule: string | null; last_run_at: string | null }>();
    const cronSchedule = (existing && existing.cron_schedule) || null;
    const lastRunAt = (existing && existing.last_run_at) || null;

    await this.db.batch([
      this.db.prepare("DELETE FROM scan_configs WHERE project_id = ? AND name = 'default'").bind(projectId),
      this.db.prepare("INSERT INTO scan_configs (id, project_id, name, config_json, cron_schedule, last_run_at) VALUES (?, ?, 'default', ?, ?, ?)").bind(id, projectId, configJson, cronSchedule, lastRunAt)
    ]);
  }

  async updateProjectSchedule(projectId: string, cronSchedule: string | null): Promise<{ oldSchedule: string | null }> {
    if (typeof projectId !== 'string') {
      throw new TypeError('projectId must be a string');
    }
    if (cronSchedule !== null && typeof cronSchedule !== 'string') {
      throw new TypeError('cronSchedule must be a string or null');
    }
    const existingConfig = await this.db.prepare(
      "SELECT id, cron_schedule FROM scan_configs WHERE project_id = ? AND name = 'default'"
    ).bind(projectId).first<{ id: string; cron_schedule: string | null }>();

    const oldSchedule = existingConfig ? existingConfig.cron_schedule : null;

    if (!existingConfig) {
      const id = ulid();
      await this.db.prepare(
        "INSERT INTO scan_configs (id, project_id, name, config_json, cron_schedule) VALUES (?, ?, 'default', ?, ?)"
      ).bind(id, projectId, "{}", cronSchedule).run();
    } else {
      await this.db.prepare(
        "UPDATE scan_configs SET cron_schedule = ? WHERE project_id = ? AND name = 'default'"
      ).bind(cronSchedule, projectId).run();
    }

    return { oldSchedule };
  }

  async updateProjectSettings(projectId: string, body: any): Promise<{ beforeDiff: Record<string, any>; afterDiff: Record<string, any>; updated: boolean }> {
    const allowedFields = ['name', 'description', 'url_mappings', 'ai_prompts', 'propose_fixes', 'custom_cli_command', 'auto_fix_rules', 'member_session_timeout'];
    
    const fieldsCSV = allowedFields.join(', ');
    const oldProj = await this.db.prepare(`SELECT ${fieldsCSV} FROM projects WHERE id = ?`)
      .bind(projectId)
      .first<Record<string, any>>();

    const setClauses: string[] = [];
    const values: any[] = [];
    const beforeDiff: Record<string, any> = {};
    const afterDiff: Record<string, any> = {};
    
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        const val = field === 'propose_fixes' ? (body[field] ? 1 : 0) : body[field];
        values.push(val);

        const oldVal = oldProj ? oldProj[field] : null;
        if (oldVal !== val) {
          beforeDiff[field] = oldVal;
          afterDiff[field] = val;
        }
      }
    }

    if (setClauses.length > 0) {
      values.push(projectId);
      await this.db.prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();
      return { beforeDiff, afterDiff, updated: true };
    }

    return { beforeDiff, afterDiff, updated: false };
  }

  async deleteProject(projectId: string): Promise<void> {
    if (typeof projectId !== 'string') {
      throw new TypeError('projectId must be a string');
    }
    await this.db.batch([
      this.db.prepare('DELETE FROM projects WHERE id = ?').bind(projectId),
      this.db.prepare('DELETE FROM project_members WHERE project_id = ?').bind(projectId),
      this.db.prepare('DELETE FROM scan_configs WHERE project_id = ?').bind(projectId),
      this.db.prepare('DELETE FROM scans WHERE project_id = ?').bind(projectId),
    ]);
  }

  async getProjectAnalytics(projectId: string, userId: string | null, period: string): Promise<any> {
    let rangeClause = "created_at >= datetime('now', '-30 days')";
    let groupClause = "DATE(created_at)";
    let selectClause = "DATE(created_at) as date";

    let findingsRangeClause = "f.created_at >= datetime('now', '-30 days')";
    let findingsSelectClause = "DATE(f.created_at) as date";
    let findingsGroupClause = "DATE(f.created_at), f.level";

    if (period === '24h') {
      rangeClause = "created_at >= datetime('now', '-24 hours')";
      groupClause = "strftime('%Y-%m-%d %H:00:00', created_at)";
      selectClause = "strftime('%Y-%m-%d %H:00:00', created_at) as date";

      findingsRangeClause = "f.created_at >= datetime('now', '-24 hours')";
      findingsSelectClause = "strftime('%Y-%m-%d %H:00:00', f.created_at) as date";
      findingsGroupClause = "strftime('%Y-%m-%d %H:00:00', f.created_at), f.level";
    } else if (period === '12w') {
      rangeClause = "created_at >= datetime('now', '-84 days')";
      groupClause = "strftime('%Y-%W', created_at)";
      selectClause = "strftime('%Y-%W', created_at) as date";

      findingsRangeClause = "f.created_at >= datetime('now', '-84 days')";
      findingsSelectClause = "strftime('%Y-%W', f.created_at) as date";
      findingsGroupClause = "strftime('%Y-%W', f.created_at), f.level";
    } else if (period === '12m') {
      rangeClause = "created_at >= datetime('now', '-12 months')";
      groupClause = "strftime('%Y-%m', created_at)";
      selectClause = "strftime('%Y-%m', created_at) as date";

      findingsRangeClause = "f.created_at >= datetime('now', '-12 months')";
      findingsSelectClause = "strftime('%Y-%m', f.created_at) as date";
      findingsGroupClause = "strftime('%Y-%m', f.created_at), f.level";
    }

    // 1. Scan stats query
    const statsQuery = await this.db.prepare(`
      SELECT 
        COUNT(*) as total_scans,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_scans,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_scans,
        AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL AND completed_at > created_at THEN (strftime('%s', completed_at) - strftime('%s', created_at)) ELSE NULL END) as avg_duration_seconds
      FROM scans 
      WHERE project_id = ?
    `).bind(projectId).first<{ total_scans: number; completed_scans: number; failed_scans: number; avg_duration_seconds: number | null }>();

    // 2. Scan history query
    const historyQuery = await this.db.prepare(`
      SELECT 
        ${selectClause}, 
        COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count
      FROM scans 
      WHERE project_id = ? AND ${rangeClause}
      GROUP BY ${groupClause}
      ORDER BY date ASC
    `).bind(projectId).all<{ date: string; count: number; completed_count: number; failed_count: number }>();

    // 3. Findings by level and category
    const findingsQuery = await this.db.prepare(`
      SELECT 
        f.level as severity,
        f.rule_id as category,
        COUNT(DISTINCT f.message) as count
      FROM findings f
      JOIN scans s ON f.scan_id = s.id
      WHERE s.project_id = ?
      GROUP BY f.level, f.rule_id
    `).bind(projectId).all<{ severity: string; category: string; count: number }>();

    // 4. Findings history over time
    const findingsHistoryQuery = await this.db.prepare(`
      SELECT 
        ${findingsSelectClause},
        f.level as severity,
        COUNT(DISTINCT f.message) as count
      FROM findings f
      JOIN scans s ON f.scan_id = s.id
      WHERE s.project_id = ? AND ${findingsRangeClause}
      GROUP BY ${findingsGroupClause}
      ORDER BY date ASC
    `).bind(projectId).all<{ date: string; severity: string; count: number }>();

    // 5. Runner metrics
    let totalConnected = 0;
    let totalBusy = 0;
    let runnersList: any[] = [];
    try {
      const doId = this.env.COORDINATOR_DO.idFromName('global-coordinator');
      const stub = this.env.COORDINATOR_DO.get(doId);
      const doRes = await stub.fetch(new Request('http://do/runners') as any);
      if (doRes.ok) {
        const data = await doRes.json() as { runners: any[] };
        runnersList = (data.runners || []).map(r => {
          const isBusy = !!(r.activeJobs && r.activeJobs.length > 0);
          return {
            name: r.name,
            isShared: !!r.isShared,
            isBusy
          };
        });
        totalConnected = runnersList.length;
        totalBusy = runnersList.filter(r => r.isBusy).length;
      }
    } catch (e) {
      console.error("Failed to query runners from Coordinator DO:", e);
    }

    const utilization = totalConnected > 0 ? (totalBusy / totalConnected) * 100 : 0;

    return {
      scanStats: {
        total: statsQuery?.total_scans || 0,
        completed: statsQuery?.completed_scans || 0,
        failed: statsQuery?.failed_scans || 0,
        avgDuration: Math.round(statsQuery?.avg_duration_seconds || 0)
      },
      scanHistory: historyQuery.results || [],
      findingsStats: findingsQuery.results || [],
      findingsHistory: findingsHistoryQuery.results || [],
      runnerMetrics: {
        totalConnected,
        totalBusy,
        utilization,
        runners: runnersList
      }
    };
  }

  async checkUserIsMember(projectId: string, userId: string): Promise<boolean> {
    const member = await this.db.prepare(
      'SELECT role FROM project_members WHERE project_id = ? AND user_id = ?'
    )
    .bind(projectId, userId)
    .first<{ role: string }>();

    return !!member;
  }

  async getUserLoginHistory(userId: string, page: number, limit: number): Promise<{ history: any[]; pagination: any }> {
    const offset = (page - 1) * limit;

    const { results } = await this.db.prepare(`
      SELECT id, status, ip_address, country, city, region, timezone, cf_ray, user_agent, auth_method, two_factor_active, created_at
      FROM user_login_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    .bind(userId, limit, offset)
    .all();

    const countRow = await this.db.prepare(`
      SELECT COUNT(*) as total FROM user_login_history WHERE user_id = ?
    `)
    .bind(userId)
    .first<{ total: number }>();

    const total = countRow?.total || 0;

    return {
      history: results || [],
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getProjectAuditLogs(projectId: string, page: number, limit: number, search: string, source: string, action: string): Promise<{ logs: any[]; pagination: any }> {
    const offset = (page - 1) * limit;

    const conditions: string[] = ['project_id = ?'];
    const params: any[] = [projectId];

    if (search) {
      conditions.push('(actor_username LIKE ? OR action_label LIKE ? OR ip_address LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (source) {
      conditions.push('source = ?');
      params.push(source);
    }
    if (action) {
      conditions.push('action LIKE ?');
      params.push(`${action}%`);
    }

    const where = conditions.join(' AND ');

    const [rows, countRow] = await Promise.all([
      this.db
        .prepare(
          `SELECT id, user_id, actor_username, actor_role, action, action_label, source, ip_address, timestamp
           FROM audit_logs
           WHERE ${where}
           ORDER BY timestamp DESC
           LIMIT ? OFFSET ?`
        )
        .bind(...params, limit, offset)
        .all(),
      this.db
        .prepare(`SELECT COUNT(*) as total FROM audit_logs WHERE ${where}`)
        .bind(...params)
        .first<{ total: number }>(),
    ]);

    const total = countRow?.total || 0;

    return {
      logs: rows.results || [],
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }
}
