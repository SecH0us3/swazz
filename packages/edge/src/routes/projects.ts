import { Hono } from 'hono';
import { Env } from '../env';
import { getDB } from '../utils/db';
import { getUserIdFromRequest, hashPassword, verifyPassword, recordFailedLogin, verifyTurnstile, checkProjectMembership, checkScanMembership, resetLoginAttempts, isWebRequest, isAnonymousUser, getClientIp } from '../utils/auth';
import { requirePermission } from '../middleware/rbac';
import { checkPermission } from '../utils/rbac';
import { ulid } from 'ulidx';
import { sign } from 'hono/jwt';
import { Project } from '../types';

export function registerProjectsRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/projects', async (c) => {
    const userId = await getUserIdFromRequest(c) || c.req.query('user_id');
    if (userId) {
      let { results } = await getDB(c.env).prepare(`
        SELECT p.* 
        FROM projects p 
        JOIN project_members m ON p.id = m.project_id 
        WHERE m.user_id = ? 
        ORDER BY p.created_at DESC
      `).bind(userId).all<Project>();
  
      // Auto-create a default project if the user has none
      if (!results || results.length === 0) {
        const projectId = ulid();
        await getDB(c.env).batch([
          getDB(c.env).prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
            .bind(projectId),
          getDB(c.env).prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
            .bind(projectId, userId),
          getDB(c.env).prepare("INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, 'owner')")
            .bind(projectId, userId)
        ]);
        
        const newProject = await getDB(c.env).prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
        results = newProject ? [newProject] : [];
      }
  
      return c.json({ projects: results });
    }
    
    // Fallback: list all
    const { results } = await getDB(c.env).prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    return c.json({ projects: results });
  });
  
  app.post('/api/projects', async (c) => {
    const userId = await getUserIdFromRequest(c) || 'anonymous';
    const body = await c.req.json();
    const id = ulid();
    
    await getDB(c.env).batch([
      getDB(c.env).prepare('INSERT INTO projects (id, name, description, url_mappings, ai_prompts, propose_fixes, custom_cli_command) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, body.name, body.description || '', body.url_mappings || null, body.ai_prompts || null, body.propose_fixes ? 1 : 0, body.custom_cli_command || null),
      getDB(c.env).prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
        .bind(id, userId, 'owner'),
      getDB(c.env).prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)')
        .bind(id, userId, 'owner')
    ]);
  
    return c.json({ id, status: 'created' });
  });
  
  app.get('/api/projects/:id/config', requirePermission('get:/api/projects/:id/config'), async (c) => {
    const projectId = c.req.param('id');
  
    const result = await getDB(c.env).prepare(
      "SELECT config_json, cron_schedule, last_run_at FROM scan_configs WHERE project_id = ? AND name = 'default'"
    )
    .bind(projectId)
    .first<{ config_json: string; cron_schedule: string | null; last_run_at: string | null }>();
  
    if (!result) {
      return c.json({ config: null, cron_schedule: null, last_run_at: null });
    }
    return c.json({
      config: JSON.parse(result.config_json),
      cron_schedule: result.cron_schedule,
      last_run_at: result.last_run_at
    });
  });
  
  app.post('/api/projects/:id/config', requirePermission('post:/api/projects/:id/config'), async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json();
  
    const configJson = JSON.stringify(body.config);
    const id = ulid();
  
    // Fetch current cron_schedule and last_run_at to preserve them
    const existing = await getDB(c.env).prepare(
      "SELECT cron_schedule, last_run_at FROM scan_configs WHERE project_id = ? AND name = 'default'"
    ).bind(projectId).first<{ cron_schedule: string | null; last_run_at: string | null }>();
    const cronSchedule = (existing && existing.cron_schedule) || null;
    const lastRunAt = (existing && existing.last_run_at) || null;

    await getDB(c.env).batch([
      getDB(c.env).prepare("DELETE FROM scan_configs WHERE project_id = ? AND name = 'default'").bind(projectId),
      getDB(c.env).prepare("INSERT INTO scan_configs (id, project_id, name, config_json, cron_schedule, last_run_at) VALUES (?, ?, 'default', ?, ?, ?)").bind(id, projectId, configJson, cronSchedule, lastRunAt)
    ]);
  
    return c.json({ status: 'saved' });
  });

  app.post('/api/projects/:id/schedule', requirePermission('post:/api/projects/:id/schedule'), async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json();
    const { cron_schedule } = body;
    
    if (cron_schedule) {
      if (typeof cron_schedule !== 'string') {
        return c.json({ error: 'cron_schedule must be a string' }, 400);
      }
      // 1. Enforce frequency limit: at most once a day
      const parts = cron_schedule.trim().split(/\s+/);
      if (parts.length !== 5) {
        return c.json({ error: 'Invalid cron format. Must have exactly 5 fields.' }, 400);
      }
      const minute = parts[0];
      const hour = parts[1];
      const isSingleMinute = /^\d+$/.test(minute) && parseInt(minute, 10) >= 0 && parseInt(minute, 10) <= 59;
      const isSingleHour = /^\d+$/.test(hour) && parseInt(hour, 10) >= 0 && parseInt(hour, 10) <= 23;
      if (!isSingleMinute || !isSingleHour) {
        return c.json({ error: 'Scan schedule cannot be more frequent than once a day (minute and hour fields must be specific single integer constants).' }, 400);
      }

      // 2. Enforce plan restriction: Supporter Plan only
      const userId = await getUserIdFromRequest(c);
      if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      const user = await getDB(c.env).prepare('SELECT plan FROM users WHERE id = ?')
        .bind(userId)
        .first<{ plan: string | null }>();
      if (!user || user.plan !== 'Supporter Plan') {
        return c.json({ error: 'Scheduled auto-scans are only available on the Supporter Plan.' }, 403);
      }
    }

    // Check if the config exists
    const existingConfig = await getDB(c.env).prepare(
      "SELECT id FROM scan_configs WHERE project_id = ? AND name = 'default'"
    ).bind(projectId).first<{ id: string }>();

    if (!existingConfig) {
      const id = ulid();
      await getDB(c.env).prepare(
        "INSERT INTO scan_configs (id, project_id, name, config_json, cron_schedule) VALUES (?, ?, 'default', ?, ?)"
      ).bind(id, projectId, "{}", cron_schedule || null).run();
    } else {
      // Update the config row
      await getDB(c.env).prepare(
        "UPDATE scan_configs SET cron_schedule = ? WHERE project_id = ? AND name = 'default'"
      ).bind(cron_schedule || null, projectId).run();
    }

    return c.json({ status: 'saved', cron_schedule });
  });
  
  app.patch('/api/projects/:id', requirePermission('patch:/api/projects/:id'), async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json();
  
    const allowedFields = ['name', 'description', 'url_mappings', 'ai_prompts', 'propose_fixes', 'custom_cli_command', 'auto_fix_rules', 'member_session_timeout'];
    const setClauses: string[] = [];
    const values: any[] = [];
    
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(field === 'propose_fixes' ? (body[field] ? 1 : 0) : body[field]);
      }
    }

    if (setClauses.length > 0) {
      values.push(projectId);
      await getDB(c.env).prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();
    }
  
    return c.json({ status: 'updated' });
  });
  
  app.delete('/api/projects/:id', requirePermission('delete:/api/projects/:id'), async (c) => {
    const projectId = c.req.param('id');
  
    await getDB(c.env).batch([
      getDB(c.env).prepare('DELETE FROM projects WHERE id = ?').bind(projectId),
      getDB(c.env).prepare('DELETE FROM project_members WHERE project_id = ?').bind(projectId),
      getDB(c.env).prepare('DELETE FROM scan_configs WHERE project_id = ?').bind(projectId),
      getDB(c.env).prepare('DELETE FROM scans WHERE project_id = ?').bind(projectId),
    ]);
  
    return c.json({ status: 'deleted' });
  });

  app.get('/api/projects/:id/analytics', async (c) => {
    const projectId = c.req.param('id');
    const userId = await getUserIdFromRequest(c);
    if (c.env.AUTH_ENABLED === 'true') {
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);
      const hasAccess = await checkPermission(c.env, userId, projectId, 'get:/api/projects/:id/scans');
      if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
    }

    const period = c.req.query('period') || '30d';

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

    const db = getDB(c.env);

    // 1. Scan stats query
    const statsQuery = await db.prepare(`
      SELECT 
        COUNT(*) as total_scans,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_scans,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_scans,
        AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL AND completed_at > created_at THEN (strftime('%s', completed_at) - strftime('%s', created_at)) ELSE NULL END) as avg_duration_seconds
      FROM scans 
      WHERE project_id = ?
    `).bind(projectId).first<{ total_scans: number; completed_scans: number; failed_scans: number; avg_duration_seconds: number | null }>();

    // 2. Scan history query (based on period)
    const historyQuery = await db.prepare(`
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

    // 3. Findings by level and category (counting unique instances by message)
    const findingsQuery = await db.prepare(`
      SELECT 
        f.level as severity,
        f.rule_id as category,
        COUNT(DISTINCT f.message) as count
      FROM findings f
      JOIN scans s ON f.scan_id = s.id
      WHERE s.project_id = ?
      GROUP BY f.level, f.rule_id
    `).bind(projectId).all<{ severity: string; category: string; count: number }>();

    // 4. Findings history over time (based on period, counting unique instances by message)
    const findingsHistoryQuery = await db.prepare(`
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
      const doId = c.env.COORDINATOR_DO.idFromName('global-coordinator');
      const stub = c.env.COORDINATOR_DO.get(doId);
      const doRes = await stub.fetch(new Request('http://do/runners'));
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

    return c.json({
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
    });
  });
  
}
