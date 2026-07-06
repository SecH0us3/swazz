import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerProjectsRoutes } from '../../../src/routes/projects';
import { IProjectService } from '../../../src/services/projects';

// Mock middleware and auth utils so we can test routes in isolation
vi.mock('../../../src/utils/auth', () => ({
  getUserIdFromRequest: vi.fn().mockResolvedValue('user_123'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: () => async (c: any, next: any) => {
    // just pass through for testing
    await next();
  },
}));

vi.mock('../../../src/middleware/auditLog', () => ({
  auditLog: () => async (c: any, next: any) => {
    await next();
  },
}));

describe('Projects Routes', () => {
  let mockServices: Partial<IProjectService>;
  let app: Hono<any>;

  beforeEach(() => {
    mockServices = {
      getProjects: vi.fn(),
      createProject: vi.fn(),
      getProjectConfig: vi.fn(),
      saveProjectConfig: vi.fn(),
      updateProjectSchedule: vi.fn(),
      updateProjectSettings: vi.fn(),
      deleteProject: vi.fn(),
      getProjectAnalytics: vi.fn(),
      getUserLoginHistory: vi.fn(),
      getProjectAuditLogs: vi.fn(),
    };

    const mockFactory = () => mockServices as IProjectService;

    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = { AUTH_ENABLED: 'true' };
      await next();
    });
    registerProjectsRoutes(app, mockFactory);
  });

  describe('GET /api/projects', () => {
    it('should return projects for authenticated user', async () => {
      (mockServices.getProjects as any).mockResolvedValue({ projects: [{ id: 'p1', name: 'Test' }] });
      
      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ projects: [{ id: 'p1', name: 'Test' }] });
      expect(mockServices.getProjects).toHaveBeenCalledWith('user_123', true);
    });

    it('should return 401 if unauthenticated and auth is enabled', async () => {
      // Mock getUserIdFromRequest to return null
      const auth = await import('../../../src/utils/auth');
      (auth.getUserIdFromRequest as any).mockResolvedValueOnce(null);

      (mockServices.getProjects as any).mockRejectedValue(new Error('Unauthorized'));

      const res = await app.request('/api/projects');
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      expect(mockServices.getProjects).toHaveBeenCalledWith(null, true);
    });
  });

  describe('POST /api/projects', () => {
    it('should create a project and return id', async () => {
      (mockServices.createProject as any).mockResolvedValue({ id: 'new_p', status: 'created' });
      
      const res = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Project' })
      });
      
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 'new_p', status: 'created' });
      expect(mockServices.createProject).toHaveBeenCalledWith('user_123', true, { name: 'New Project' });
    });
  });

  describe('GET /api/projects/:id/config', () => {
    it('should return project config', async () => {
      (mockServices.getProjectConfig as any).mockResolvedValue({ config_json: '{}' });
      
      const res = await app.request('/api/projects/proj_1/config');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ config_json: '{}' });
      expect(mockServices.getProjectConfig).toHaveBeenCalledWith('proj_1');
    });
  });

  describe('GET /api/projects/:id/analytics', () => {
    it('should pass correct default period', async () => {
      (mockServices.getProjectAnalytics as any).mockResolvedValue({ metrics: [] });
      
      const res = await app.request('/api/projects/proj_1/analytics');
      expect(res.status).toBe(200);
      expect(mockServices.getProjectAnalytics).toHaveBeenCalledWith('proj_1', 'user_123', '30d', true);
    });

    it('should pass provided period', async () => {
      (mockServices.getProjectAnalytics as any).mockResolvedValue({ metrics: [] });
      
      const res = await app.request('/api/projects/proj_1/analytics?period=24h');
      expect(res.status).toBe(200);
      expect(mockServices.getProjectAnalytics).toHaveBeenCalledWith('proj_1', 'user_123', '24h', true);
    });
  });

  describe('GET /api/projects/:id/members/:user_id/login-history', () => {
    it('should handle pagination and return history', async () => {
      (mockServices.getUserLoginHistory as any).mockResolvedValue({ items: [], total: 0 });
      
      const res = await app.request('/api/projects/proj_1/members/usr_2/login-history?page=2&limit=50');
      expect(res.status).toBe(200);
      expect(mockServices.getUserLoginHistory).toHaveBeenCalledWith('proj_1', 'usr_2', '2', '50');
    });

    it('should pass negative inputs raw to the service', async () => {
      (mockServices.getUserLoginHistory as any).mockResolvedValue({ items: [], total: 0 });
      
      const res = await app.request('/api/projects/proj_1/members/usr_2/login-history?page=-5&limit=-10');
      expect(res.status).toBe(200);
      expect(mockServices.getUserLoginHistory).toHaveBeenCalledWith('proj_1', 'usr_2', '-5', '-10');
    });

    it('should return 404 if user is not a member', async () => {
      (mockServices.getUserLoginHistory as any).mockRejectedValue(new Error('User is not a member of this project|404'));
      
      const res = await app.request('/api/projects/proj_1/members/usr_2/login-history');
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'User is not a member of this project' });
    });
  });

  describe('GET /api/projects/:id/audit-logs', () => {
    it('should handle search, source, and action filters', async () => {
      (mockServices.getProjectAuditLogs as any).mockResolvedValue({ items: [], total: 0 });
      
      const res = await app.request('/api/projects/proj_1/audit-logs?search=test&source=web&action=login');
      expect(res.status).toBe(200);
      expect(mockServices.getProjectAuditLogs).toHaveBeenCalledWith('proj_1', '1', '20', 'test', 'web', 'login');
    });

    it('should pass invalid limits raw to service', async () => {
      (mockServices.getProjectAuditLogs as any).mockResolvedValue({ items: [], total: 0 });
      
      const res = await app.request('/api/projects/proj_1/audit-logs?page=0&limit=500');
      expect(res.status).toBe(200);
      expect(mockServices.getProjectAuditLogs).toHaveBeenCalledWith('proj_1', '0', '500', '', '', '');
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('should update settings and set auditDetails', async () => {
      (mockServices.updateProjectSettings as any).mockResolvedValue({ status: 'updated', auditDetails: { before: { name: 'Old' }, after: { name: 'New' } } });
      
      const res = await app.request('/api/projects/proj_1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New' })
      });
      
      expect(res.status).toBe(200);
      expect(mockServices.updateProjectSettings).toHaveBeenCalledWith('proj_1', { name: 'New' });
    });
  });

  describe('POST /api/projects/:id/schedule', () => {
    it('should update schedule', async () => {
      (mockServices.updateProjectSchedule as any).mockResolvedValue({ status: 'saved', cron_schedule: '30 2 * * *' });
      
      const res = await app.request('/api/projects/proj_1/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cron_schedule: '30 2 * * *' })
      });
      
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'saved', cron_schedule: '30 2 * * *' });
      expect(mockServices.updateProjectSchedule).toHaveBeenCalledWith('proj_1', { cron_schedule: '30 2 * * *' });
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('should delete project', async () => {
      (mockServices.deleteProject as any).mockResolvedValue({ status: 'deleted' });
      
      const res = await app.request('/api/projects/proj_1', {
        method: 'DELETE'
      });
      
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'deleted' });
      expect(mockServices.deleteProject).toHaveBeenCalledWith('proj_1');
    });
  });
});
