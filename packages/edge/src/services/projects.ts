import { Env } from '../env';
import { IProjectRepository } from '../repositories/projects';
import { IRbacRepository } from '../repositories/rbac';

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
    return { webhooks };
  }

  async createProjectWebhook(projectId: string, body: any) {
    const { url, headers, event_types } = body;
    if (!url || typeof url !== 'string') {
      throw new Error('URL is required and must be a string|400');
    }
    try {
      new URL(url);
    } catch {
      throw new Error('Invalid URL format|400');
    }
    if (headers && typeof headers !== 'string') {
      try {
        JSON.stringify(headers);
      } catch {
        throw new Error('Headers must be a valid JSON object or string|400');
      }
    }
    if (!event_types || !Array.isArray(event_types) || event_types.length === 0) {
      throw new Error('Event types must be a non-empty array|400');
    }
    const validEvents = ["scan.started", "scan.completed", "scan.failed", "finding.created", "finding.triaged"];
    for (const event of event_types) {
      if (!validEvents.includes(event)) {
        throw new Error(`Invalid event type: ${event}|400`);
      }
    }

    const id = crypto.randomUUID();
    const headersStr = headers ? (typeof headers === 'string' ? headers : JSON.stringify(headers)) : null;
    const eventTypesStr = JSON.stringify(event_types);

    await this.projectRepo.createProjectWebhook(id, projectId, url, headersStr, eventTypesStr);
    return { id, status: 'created' };
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
      new URL(url);
    } catch {
      throw new Error('Invalid URL format|400');
    }
    if (headers && typeof headers !== 'string') {
      try {
        JSON.stringify(headers);
      } catch {
        throw new Error('Headers must be a valid JSON object or string|400');
      }
    }
    if (!event_types || !Array.isArray(event_types) || event_types.length === 0) {
      throw new Error('Event types must be a non-empty array|400');
    }
    const validEvents = ["scan.started", "scan.completed", "scan.failed", "finding.created", "finding.triaged"];
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
      webhook_id: webhookId,
      data: {
        message: 'This is a test notification from Swazz API Fuzzer webhook configuration.'
      }
    };

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

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: headersObj,
        body: JSON.stringify(testPayload)
      });

      if (!response.ok) {
        throw new Error(`Webhook target returned status ${response.status}`);
      }

      return { status: 'success', statusCode: response.status };
    } catch (err: any) {
      throw new Error(`Webhook test failed: ${err.message}|400`);
    }
  }
}
