import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, hashPassword, verifyPassword, recordFailedLogin, verifyTurnstile, checkProjectMembership, checkScanMembership, resetLoginAttempts, isWebRequest, isAnonymousUser, getClientIp } from '../utils/auth';
import { requirePermission } from '../middleware/rbac';
import { ulid } from 'ulidx';
import { sign } from 'hono/jwt';
import { Project } from '../types';

export function registerProjectsRoutes(app: Hono<{ Bindings: Env }>) {
  app.get('/api/projects', async (c) => {
    const userId = await getUserIdFromRequest(c) || c.req.query('user_id');
    if (userId) {
      let { results } = await c.env.DB.prepare(`
        SELECT p.* 
        FROM projects p 
        JOIN project_members m ON p.id = m.project_id 
        WHERE m.user_id = ? 
        ORDER BY p.created_at DESC
      `).bind(userId).all<Project>();
  
      // Auto-create a default project if the user has none
      if (!results || results.length === 0) {
        const projectId = ulid();
        await c.env.DB.batch([
          c.env.DB.prepare("INSERT INTO projects (id, name, description) VALUES (?, 'Default Project', 'My first Swazz project')")
            .bind(projectId),
          c.env.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
            .bind(projectId, userId),
          c.env.DB.prepare("INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, 'owner')")
            .bind(projectId, userId)
        ]);
        
        const newProject = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>();
        results = newProject ? [newProject] : [];
      }
  
      return c.json({ projects: results });
    }
    
    // Fallback: list all
    const { results } = await c.env.DB.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    return c.json({ projects: results });
  });
  
  app.post('/api/projects', async (c) => {
    const userId = await getUserIdFromRequest(c) || 'anonymous';
    const body = await c.req.json();
    const id = ulid();
    
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO projects (id, name, description, url_mappings, ai_prompts, propose_fixes, custom_cli_command) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, body.name, body.description || '', body.url_mappings || null, body.ai_prompts || null, body.propose_fixes ? 1 : 0, body.custom_cli_command || null),
      c.env.DB.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
        .bind(id, userId, 'owner'),
      c.env.DB.prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)')
        .bind(id, userId, 'owner')
    ]);
  
    return c.json({ id, status: 'created' });
  });
  
  app.get('/api/projects/:id/config', requirePermission('get:/api/projects/:id/config'), async (c) => {
    const projectId = c.req.param('id');
  
    const result = await c.env.DB.prepare(
      "SELECT config_json FROM scan_configs WHERE project_id = ? AND name = 'default'"
    )
    .bind(projectId)
    .first<{ config_json: string }>();
  
    if (!result) {
      return c.json({ config: null });
    }
    return c.json({ config: JSON.parse(result.config_json) });
  });
  
  app.post('/api/projects/:id/config', requirePermission('post:/api/projects/:id/config'), async (c) => {
    const projectId = c.req.param('id');
    const body = await c.req.json();
  
    const configJson = JSON.stringify(body.config);
    const id = ulid();
  
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM scan_configs WHERE project_id = ? AND name = 'default'").bind(projectId),
      c.env.DB.prepare("INSERT INTO scan_configs (id, project_id, name, config_json) VALUES (?, ?, 'default', ?)").bind(id, projectId, configJson)
    ]);
  
    return c.json({ status: 'saved' });
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
      await c.env.DB.prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();
    }
  
    return c.json({ status: 'updated' });
  });
  
  app.delete('/api/projects/:id', requirePermission('delete:/api/projects/:id'), async (c) => {
    const projectId = c.req.param('id');
  
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(projectId),
      c.env.DB.prepare('DELETE FROM project_members WHERE project_id = ?').bind(projectId),
      c.env.DB.prepare('DELETE FROM scan_configs WHERE project_id = ?').bind(projectId),
      c.env.DB.prepare('DELETE FROM scans WHERE project_id = ?').bind(projectId),
    ]);
  
    return c.json({ status: 'deleted' });
  });
  
}
