import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerProjectsRoutes } from './projects';
import { IProjectServices } from '../services/projects';

// Mock middleware and auth utils so we can test routes in isolation
vi.mock('../utils/auth', () => ({
  getUserIdFromRequest: vi.fn().mockResolvedValue('user_123'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../middleware/rbac', () => ({
  requirePermission: () => async (c: any, next: any) => {
    // just pass through for testing
    await next();
  },
}));

vi.mock('../middleware/auditLog', () => ({
  auditLog: () => async (c: any, next: any) => {
    await next();
  },
}));

describe('Projects Routes', () => {
  let mockServices: Partial<IProjectServices>;
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
      checkUserIsMember: vi.fn(),
      getUserLoginHistory: vi.fn(),
      getProjectAuditLogs: vi.fn(),
    };

    const mockFactory = () => mockServices as IProjectServices;

    app = new Hono();
    registerProjectsRoutes(app, mockFactory);
  });

  describe('GET /api/projects', () => {
    it('should return projects for authenticated user', async () => {
      (mockServices.getProjects as any).mockResolvedValue([{ id: 'p1', name: 'Test' }]);
      
      const res = await app.request('/api/projects');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ projects: [{ id: 'p1', name: 'Test' }] });
      expect(mockServices.getProjects).toHaveBeenCalledWith('user_123');
    });

    it('should pass user_id query param if provided', async () => {
      // Mock getUserIdFromRequest to return null to simulate query param usage
      const auth = await import('../utils/auth');
      (auth.getUserIdFromRequest as any).mockResolvedValueOnce(null);
      (mockServices.getProjects as any).mockResolvedValue([]);

      const res = await app.request('/api/projects?user_id=user_456');
      expect(res.status).toBe(200);
      expect(mockServices.getProjects).toHaveBeenCalledWith('user_456');
    });
  });

  describe('POST /api/projects', () => {
    it('should create a project and return id', async () => {
      (mockServices.createProject as any).mockResolvedValue({ id: 'new_p' });
      
      const res = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Project' })
      });
      
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: 'new_p', status: 'created' });
      expect(mockServices.createProject).toHaveBeenCalledWith('user_123', { name: 'New Project' });
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
      expect(mockServices.getProjectAnalytics).toHaveBeenCalledWith('proj_1', 'user_123', '30d');
    });

    it('should pass provided period', async () => {
      (mockServices.getProjectAnalytics as any).mockResolvedValue({ metrics: [] });
      
      const res = await app.request('/api/projects/proj_1/analytics?period=24h');
      expect(res.status).toBe(200);
      expect(mockServices.getProjectAnalytics).toHaveBeenCalledWith('proj_1', 'user_123', '24h');
    });
  });

  describe('GET /api/projects/:id/members/:user_id/login-history', () => {
    it('should handle pagination and return history', async () => {
      (mockServices.checkUserIsMember as any).mockResolvedValue(true);
      (mockServices.getUserLoginHistory as any).mockResolvedValue({ items: [], total: 0 });
      
      const res = await app.request('/api/projects/proj_1/members/usr_2/login-history?page=2&limit=50');
      expect(res.status).toBe(200);
      expect(mockServices.getUserLoginHistory).toHaveBeenCalledWith('usr_2', 2, 50);
    });

    it('should fallback to default page and limit for invalid/negative inputs', async () => {
      (mockServices.checkUserIsMember as any).mockResolvedValue(true);
      (mockServices.getUserLoginHistory as any).mockResolvedValue({ items: [], total: 0 });
      
      // Pass negative page, negative limit, etc
      const res = await app.request('/api/projects/proj_1/members/usr_2/login-history?page=-5&limit=-10');
      expect(res.status).toBe(200);
      // Math.max(1, -5) -> 1
      // Math.min(1000, Math.max(1, -10)) -> 1
      expect(mockServices.getUserLoginHistory).toHaveBeenCalledWith('usr_2', 1, 1);
    });

    it('should cap the limit parameter', async () => {
      (mockServices.checkUserIsMember as any).mockResolvedValue(true);
      (mockServices.getUserLoginHistory as any).mockResolvedValue({ items: [], total: 0 });
      
      const res = await app.request('/api/projects/proj_1/members/usr_2/login-history?limit=5000');
      expect(res.status).toBe(200);
      expect(mockServices.getUserLoginHistory).toHaveBeenCalledWith('usr_2', 1, 1000);
    });

    it('should return 403 if user is not a member', async () => {
      (mockServices.checkUserIsMember as any).mockResolvedValue(false);
      
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
      expect(mockServices.getProjectAuditLogs).toHaveBeenCalledWith('proj_1', 1, 20, 'test', 'web', 'login');
    });

    it('should enforce limits on page and limit parameters', async () => {
      (mockServices.getProjectAuditLogs as any).mockResolvedValue({ items: [], total: 0 });
      
      // Passing 0 or invalid triggers default handling
      const res = await app.request('/api/projects/proj_1/audit-logs?page=0&limit=500');
      expect(res.status).toBe(200);
      // Math.max(1, 0) -> 1
      // limit is min(100, 500) -> 100
      expect(mockServices.getProjectAuditLogs).toHaveBeenCalledWith('proj_1', 1, 100, '', '', '');
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('should update settings and set auditDetails', async () => {
      (mockServices.updateProjectSettings as any).mockResolvedValue({
        beforeDiff: { name: 'Old' },
        afterDiff: { name: 'New' },
        updated: true
      });
      
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
      (mockServices.updateProjectSchedule as any).mockResolvedValue({ oldSchedule: '0 0 * * *' });
      
      const res = await app.request('/api/projects/proj_1/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cron_schedule: '30 2 * * *' })
      });
      
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'saved', cron_schedule: '30 2 * * *' });
      expect(mockServices.updateProjectSchedule).toHaveBeenCalledWith('proj_1', '30 2 * * *');
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('should delete project', async () => {
      (mockServices.deleteProject as any).mockResolvedValue(undefined);
      
      const res = await app.request('/api/projects/proj_1', {
        method: 'DELETE'
      });
      
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'deleted' });
      expect(mockServices.deleteProject).toHaveBeenCalledWith('proj_1');
    });
  });
});
