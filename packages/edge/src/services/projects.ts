import { Env } from '../env';
import { IProjectRepository } from '../repositories/projects';
import { IRbacRepository } from '../repositories/rbac';
import { signWebhookPayload } from '../utils/webhooks';
import { ulid } from 'ulidx';
import { hashPassword, hashApiKey, hashUsername } from '../utils/auth';
import { AuthRepository } from '../repositories/auth';

export interface IProjectService {
  getProjects(userId: string | null, isAuthEnabled: boolean): Promise<{ projects: any[] }>;
  createProject(userId: string | null, isAuthEnabled: boolean, body: any): Promise<{ id: string; status: string }>;
  getProjectConfig(projectId: string): Promise<any>;
  saveProjectConfig(projectId: string, config: any): Promise<{ status: string }>;
  updateProjectSchedule(projectId: string, body: any): Promise<{ status: string; cron_schedule: string | null; auditDetails: any }>;
  updateProjectSettings(projectId: string, body: any): Promise<{ status: string; auditDetails?: any }>;
  deleteProject(projectId: string): Promise<{ status: string }>;
  getProjectAnalytics(projectId: string, userId: string | null, period: string, isAuthEnabled: boolean): Promise<any>;
  getUserLoginHistory(projectId: string, userId: string, queryPage: string, queryLimit: string): Promise<any>;
  getProjectAuditLogs(projectId: string, queryPage: string, queryLimit: string, search: string, source: string, action: string): Promise<any>;
  getProjectWebhooks(projectId: string): Promise<any>;
  createProjectWebhook(projectId: string, body: any): Promise<any>;
  updateProjectWebhook(projectId: string, webhookId: string, body: any): Promise<any>;
  deleteProjectWebhook(projectId: string, webhookId: string): Promise<any>;
  testProjectWebhook(projectId: string, webhookId: string): Promise<any>;
  createProjectMemberAccount(projectId: string, body: any): Promise<any>;
}

export class ProjectService implements IProjectService {
  constructor(
    private env: Env, 
    private projectRepo: IProjectRepository,
    private rbacRepo: IRbacRepository
  ) {}

  async getProjects(userId: string | null, isAuthEnabled: boolean) {
    if (!userId && isAuthEnabled) {
      throw new Error('Unauthorized|401');
    }
    const projects = await this.projectRepo.getProjects(userId);
    return { projects };
  }

  async createProject(userId: string | null, isAuthEnabled: boolean, body: any) {
    let resolvedUserId = userId;
    if (!resolvedUserId) {
      if (isAuthEnabled) {
        throw new Error('Unauthorized|401');
      }
      resolvedUserId = 'anonymous';
    }
    
    const { id } = await this.projectRepo.createProject(resolvedUserId, body);
    return { id, status: 'created' };
  }

  async getProjectConfig(projectId: string) {
    return this.projectRepo.getProjectConfig(projectId);
  }

  async saveProjectConfig(projectId: string, config: any) {
    await this.projectRepo.saveProjectConfig(projectId, config);
    return { status: 'saved' };
  }

  async updateProjectSchedule(projectId: string, body: any) {
    const { cron_schedule } = body;
    
    if (cron_schedule) {
      if (typeof cron_schedule !== 'string') {
        throw new Error('cron_schedule must be a string|400');
      }
      const parts = cron_schedule.trim().split(/\s+/);
      if (parts.length !== 5) {
        throw new Error('Invalid cron format. Must have exactly 5 fields.|400');
      }
      const minute = parts[0];
      const hour = parts[1];
      const isSingleMinute = /^\d+$/.test(minute) && parseInt(minute, 10) >= 0 && parseInt(minute, 10) <= 59;
      const isSingleHour = /^\d+$/.test(hour) && parseInt(hour, 10) >= 0 && parseInt(hour, 10) <= 23;
      if (!isSingleMinute || !isSingleHour) {
        throw new Error('Scan schedule cannot be more frequent than once a day (minute and hour fields must be specific single integer constants).|400');
      }
    }

    const { oldSchedule } = await this.projectRepo.updateProjectSchedule(projectId, cron_schedule || null);

    return { 
      status: 'saved', 
      cron_schedule: cron_schedule || null,
      auditDetails: {
        before: { cron_schedule: oldSchedule },
        after: { cron_schedule: cron_schedule || null }
      }
    };
  }

  async updateProjectSettings(projectId: string, body: any) {
    const { beforeDiff, afterDiff, updated } = await this.projectRepo.updateProjectSettings(projectId, body);

    const result: any = { status: 'updated' };
    if (updated) {
      result.auditDetails = {
        before: beforeDiff,
        after: afterDiff
      };
    }
    return result;
  }

  async deleteProject(projectId: string) {
    await this.projectRepo.deleteProject(projectId);
    return { status: 'deleted' };
  }

  async getProjectAnalytics(projectId: string, userId: string | null, period: string, isAuthEnabled: boolean) {
    if (isAuthEnabled) {
      if (!userId) throw new Error('Unauthorized|401');
      const hasAccess = await this.rbacRepo.checkPermission(userId, projectId, 'get:/api/projects/:id/scans');
      if (!hasAccess) throw new Error('Forbidden|403');
    }
    return this.projectRepo.getProjectAnalytics(projectId, userId, period);
  }

  async getUserLoginHistory(projectId: string, userId: string, queryPage: string, queryLimit: string) {
    const isMember = await this.projectRepo.checkUserIsMember(projectId, userId);
    if (!isMember) {
      throw new Error('User is not a member of this project|404');
    }

    const page = Math.max(1, parseInt(queryPage || '1', 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(queryLimit || '20', 10) || 20));

    return this.projectRepo.getUserLoginHistory(userId, page, limit);
  }

  async getProjectAuditLogs(projectId: string, queryPage: string, queryLimit: string, search: string, source: string, action: string) {
    const page = Math.max(1, parseInt(queryPage || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(queryLimit || '20', 10) || 20));
    
    const cleanSearch = (search || '').trim();
    const cleanSource = (source || '').trim();
    const cleanAction = (action || '').trim();

    return this.projectRepo.getProjectAuditLogs(projectId, page, limit, cleanSearch, cleanSource, cleanAction);
  }

  async getProjectWebhooks(projectId: string) {
    const webhooks = await this.projectRepo.getProjectWebhooks(projectId);
    const parsedWebhooks = webhooks.map(w => {
      const maskedSecret = w.secret ? 'whsec_••••••••••••••••••••••••••••••••' : '';
      try {
        return {
          ...w,
          secret: maskedSecret,
          event_types: typeof w.event_types === 'string' ? JSON.parse(w.event_types) : w.event_types
        };
      } catch {
        return {
          ...w,
          secret: maskedSecret,
          event_types: []
        };
      }
    });
    return { webhooks: parsedWebhooks };
  }

  async createProjectWebhook(projectId: string, body: any) {
    const { url, headers, event_types } = body;
    if (!url || typeof url !== 'string') {
      throw new Error('URL is required and must be a string|400');
    }
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('URL protocol must be http or https|400');
      }
    } catch (urlErr: any) {
      if (urlErr.message?.includes('|400')) {
        throw urlErr;
      }
      throw new Error('Invalid URL format|400');
    }
    if (headers) {
      try {
        const parsed = typeof headers === 'string' ? JSON.parse(headers) : headers;
        if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
          throw new Error();
        }
      } catch {
        throw new Error('Headers must be a valid JSON object or JSON string|400');
      }
    }
    if (!event_types || !Array.isArray(event_types) || event_types.length === 0) {
      throw new Error('Event types must be a non-empty array|400');
    }
    const validEvents = ["scan.started", "scan.completed", "scan.failed", "finding.triaged"];
    for (const event of event_types) {
      if (!validEvents.includes(event)) {
        throw new Error(`Invalid event type: ${event}|400`);
      }
    }

    const id = crypto.randomUUID();
    const secret = 'whsec_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('');
    const headersStr = headers ? (typeof headers === 'string' ? headers : JSON.stringify(headers)) : null;
    const eventTypesStr = JSON.stringify(event_types);

    await this.projectRepo.createProjectWebhook(id, projectId, url, headersStr, eventTypesStr, secret);
    return { id, secret, status: 'created' };
  }

  async updateProjectWebhook(projectId: string, webhookId: string, body: any) {
    const webhook = await this.projectRepo.getProjectWebhook(webhookId);
    if (!webhook || webhook.project_id !== projectId) {
      throw new Error('Webhook not found|404');
    }

    const { url, headers, event_types } = body;
    if (!url || typeof url !== 'string') {
      throw new Error('URL is required and must be a string|400');
    }
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('URL protocol must be http or https|400');
      }
    } catch (urlErr: any) {
      if (urlErr.message?.includes('|400')) {
        throw urlErr;
      }
      throw new Error('Invalid URL format|400');
    }
    if (headers) {
      try {
        const parsed = typeof headers === 'string' ? JSON.parse(headers) : headers;
        if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
          throw new Error();
        }
      } catch {
        throw new Error('Headers must be a valid JSON object or JSON string|400');
      }
    }
    if (!event_types || !Array.isArray(event_types) || event_types.length === 0) {
      throw new Error('Event types must be a non-empty array|400');
    }
    const validEvents = ["scan.started", "scan.completed", "scan.failed", "finding.triaged"];
    for (const event of event_types) {
      if (!validEvents.includes(event)) {
        throw new Error(`Invalid event type: ${event}|400`);
      }
    }

    const headersStr = headers ? (typeof headers === 'string' ? headers : JSON.stringify(headers)) : null;
    const eventTypesStr = JSON.stringify(event_types);

    await this.projectRepo.updateProjectWebhook(webhookId, url, headersStr, eventTypesStr);
    return { status: 'updated' };
  }

  async deleteProjectWebhook(projectId: string, webhookId: string) {
    const webhook = await this.projectRepo.getProjectWebhook(webhookId);
    if (!webhook || webhook.project_id !== projectId) {
      throw new Error('Webhook not found|404');
    }
    await this.projectRepo.deleteProjectWebhook(webhookId);
    return { status: 'deleted' };
  }

  async testProjectWebhook(projectId: string, webhookId: string) {
    const webhook = await this.projectRepo.getProjectWebhook(webhookId);
    if (!webhook || webhook.project_id !== projectId) {
      throw new Error('Webhook not found|404');
    }

    const testPayload = {
      event: 'test.ping',
      timestamp: new Date().toISOString(),
      project_id: projectId,
      data: {
        webhook_id: webhookId,
        message: 'This is a test notification from Swazz API Fuzzer webhook configuration.'
      }
    };
    const payloadStr = JSON.stringify(testPayload);

    const headersObj: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Swazz-Webhook-Dispatcher/1.0'
    };

    if (webhook.headers) {
      try {
        const parsed = JSON.parse(webhook.headers);
        Object.assign(headersObj, parsed);
      } catch {}
    }

    if (webhook.secret) {
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = await signWebhookPayload(webhook.secret, timestamp, payloadStr);
        headersObj['X-Swazz-Signature'] = `t=${timestamp},v1=${signature}`;
      } catch (err: any) {
        console.error('Failed to sign test webhook payload:', err);
      }
    }

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: headersObj,
        body: payloadStr,
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error(`Webhook target returned status ${response.status}`);
      }

      return { status: 'success', statusCode: response.status };
    } catch (err: any) {
      throw new Error(`Webhook test failed: ${err.message}|400`);
    }
  }

  async createProjectMemberAccount(projectId: string, body: any) {
    if (!body || typeof body !== 'object') {
      throw new Error('Invalid request body|400');
    }

    const { username, email, roles, is_interactive } = body;
    
    if (typeof username !== 'string') {
      throw new Error('Username is required|400');
    }
    const cleanUsername = username.trim();
    const usernameRegex = /^[a-zA-Z0-9_\-]{3,20}$/;
    if (!usernameRegex.test(cleanUsername)) {
      throw new Error('Username must be 3-20 characters long and contain only letters, numbers, underscores, or hyphens|400');
    }

    if (email) {
      if (typeof email !== 'string') {
        throw new TypeError('Email must be a string|400');
      }
      const cleanEmail = email.trim();
      const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
      if (!emailRegex.test(cleanEmail)) {
        throw new Error('Invalid email format|400');
      }
      const authRepo = new AuthRepository(this.env);
      const existingEmail = await authRepo.getUserByEmail(cleanEmail);
      if (existingEmail) {
        throw new Error('Email already exists|400');
      }
    }

    if (!Array.isArray(roles) || roles.length === 0) {
      throw new Error('At least one role must be assigned|400');
    }

    const uniqueRoles = Array.from(new Set(roles));

    const defaultRoles = ['owner', 'editor', 'viewer'];
    const customRoles = uniqueRoles.filter(r => !defaultRoles.includes(r));
    if (customRoles.length > 0) {
      const existingCustom = await this.rbacRepo.checkCustomRolesExist(projectId, customRoles);
      if (existingCustom.length !== customRoles.length) {
        throw new Error('One or more custom roles are invalid|400');
      }
    }

    const authRepo = new AuthRepository(this.env);
    const usernameHash = await hashUsername(cleanUsername);
    const exists = await authRepo.checkUsernameExists(usernameHash);
    if (exists) {
      throw new Error('Username already exists|400');
    }

    const isInteractive = is_interactive !== false;
    const userId = ulid();

    let password = '';
    let hash = '';
    let apiKey = '';
    let hashedApiKey = '';

    if (isInteractive) {
      // Interactive user: generate secure temporary password without modulo bias
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const temp = new Uint8Array(1);
      password = '';
      while (password.length < 16) {
        crypto.getRandomValues(temp);
        const val = temp[0];
        if (val < 248) { // 256 - (256 % 62) = 248
          password += chars[val % 62];
        }
      }
      hash = await hashPassword(password);
    } else {
      // Non-interactive service account: generate permanent API key
      apiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
      hashedApiKey = await hashApiKey(apiKey);
      // Set dummy password hash that cannot be matched
      hash = await hashPassword(crypto.randomUUID());
    }

    const cleanEmail = email ? email.trim() : null;

    const stmts = [
      this.env.DB.prepare('INSERT INTO username_registry (username_hash) VALUES (?)').bind(usernameHash),
      this.env.DB.prepare("INSERT INTO users (id, username, password_hash, api_key, email, is_interactive, plan) VALUES (?, ?, ?, ?, ?, ?, 'Free')")
        .bind(userId, cleanUsername, hash, hashedApiKey || null, cleanEmail, isInteractive ? 1 : 0),
      this.env.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)")
        .bind(projectId, userId, uniqueRoles[0])
    ];

    uniqueRoles.forEach((r: string) => {
      stmts.push(this.env.DB.prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)').bind(projectId, userId, r));
    });

    await this.env.DB.batch(stmts);

    return {
      status: 'ok',
      id: userId,
      username: cleanUsername,
      ...(isInteractive ? { password } : { api_key: apiKey })
    };
  }
}
