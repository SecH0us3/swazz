import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectRepository } from '../../../src/repositories/projects';
import { Env } from '../../../src/env';

describe('ProjectRepository Unit Tests', () => {
  let mockAll: any;
  let mockBind: any;
  let mockPrepare: any;
  let mockBatch: any;
  let mockDB: any;
  let mockEnv: Env;
  let mockStub: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAll = vi.fn();
    const mockStmt: any = {
      all: mockAll,
      first: mockAll,
      run: mockAll
    };
    mockBind = vi.fn().mockReturnValue(mockStmt);
    mockStmt.bind = mockBind;

    mockPrepare = vi.fn().mockReturnValue(mockStmt);
    mockBatch = vi.fn().mockResolvedValue([]);
    mockDB = {
      prepare: mockPrepare,
      batch: mockBatch
    };

    mockStub = {
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        runners: [{ name: 'runner-1', activeJobs: ['run-1'], isShared: false }]
      }), { status: 200 }))
    };

    mockEnv = {
      DB: mockDB,
      COORDINATOR_DO: {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id-123' }),
        get: vi.fn().mockReturnValue(mockStub)
      }
    } as unknown as Env;
  });

  describe('getProjects', () => {
    it('throws TypeError if userId is not a string or null', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.getProjects(123 as any)).rejects.toThrow(TypeError);
    });

    it('returns projects if user has projects', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'p1', name: 'Proj 1' }] });
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjects('user-1');
      expect(res).toEqual([{ id: 'p1', name: 'Proj 1' }]);
    });

    it('creates default project if user has none', async () => {
      mockAll.mockResolvedValueOnce({ results: [] }); // projects check empty
      mockAll.mockResolvedValueOnce({ id: 'new-p', name: 'Default Project' }); // select new project
      
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjects('user-1');
      expect(mockBatch).toHaveBeenCalled();
      expect(res).toEqual([{ id: 'new-p', name: 'Default Project' }]);
    });

    it('queries all projects if userId is null', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'p1' }] });
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjects(null);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM projects'));
      expect(res).toEqual([{ id: 'p1' }]);
    });
  });

  describe('createProject', () => {
    it('throws TypeErrors for invalid arguments', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.createProject(123 as any, {})).rejects.toThrow(TypeError);
      await expect(repo.createProject('user-1', 'not-an-object')).rejects.toThrow(TypeError);
      await expect(repo.createProject('user-1', { name: 123 })).rejects.toThrow(TypeError);
    });

    it('creates project via batch execution', async () => {
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.createProject('user-1', { name: 'New Project', description: 'Desc' });
      expect(mockBatch).toHaveBeenCalled();
      expect(res.id).toBeDefined();
    });
  });

  describe('getProjectConfig', () => {
    it('throws TypeError if projectId is not a string', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.getProjectConfig(123 as any)).rejects.toThrow(TypeError);
    });

    it('returns empty config if none found', async () => {
      mockAll.mockResolvedValueOnce(undefined);
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjectConfig('p1');
      expect(res).toEqual({ config: null, cron_schedule: null, last_run_at: null });
    });

    it('returns parsed JSON config', async () => {
      mockAll.mockResolvedValueOnce({
        config_json: '{"auto_fix": true}',
        cron_schedule: '*/5 * * * *',
        last_run_at: '2026-07-08'
      });
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjectConfig('p1');
      expect(res.config).toEqual({ auto_fix: true });
    });

    it('handles invalid JSON gracefully', async () => {
      mockAll.mockResolvedValueOnce({
        config_json: 'invalid_json',
        cron_schedule: null,
        last_run_at: null
      });
      const spyConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjectConfig('p1');
      expect(res.config).toBeNull();
      expect(spyConsoleError).toHaveBeenCalled();
      spyConsoleError.mockRestore();
    });
  });

  describe('saveProjectConfig', () => {
    it('deletes and inserts config preserving cron/last_run_at', async () => {
      mockAll.mockResolvedValueOnce({ cron_schedule: 'schedule', last_run_at: 'date' });
      const repo = new ProjectRepository(mockEnv);
      await repo.saveProjectConfig('p1', { val: 1 });
      expect(mockBatch).toHaveBeenCalled();
    });
  });

  describe('updateProjectSchedule', () => {
    it('throws TypeErrors for invalid arguments', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.updateProjectSchedule(123 as any, null)).rejects.toThrow(TypeError);
      await expect(repo.updateProjectSchedule('p1', 123 as any)).rejects.toThrow(TypeError);
    });

    it('inserts schedule if config is missing', async () => {
      mockAll.mockResolvedValueOnce(undefined);
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.updateProjectSchedule('p1', 'cron');
      expect(res.oldSchedule).toBeNull();
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO scan_configs'));
    });

    it('updates schedule if config exists', async () => {
      mockAll.mockResolvedValueOnce({ id: 'conf-1', cron_schedule: 'old' });
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.updateProjectSchedule('p1', 'new');
      expect(res.oldSchedule).toBe('old');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE scan_configs'));
    });
  });

  describe('updateProjectSettings', () => {
    it('does not prepare update statement if no valid fields are provided', async () => {
      mockAll.mockResolvedValueOnce({ name: 'Old name' });
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.updateProjectSettings('p1', {});
      expect(mockPrepare).toHaveBeenCalledTimes(1); // Only for SELECT
      expect(res.updated).toBe(false);
    });

    it('prepares update statement and maps differences', async () => {
      mockAll.mockResolvedValueOnce({ name: 'Old name', propose_fixes: 0 });
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.updateProjectSettings('p1', { name: 'New name', propose_fixes: true });
      expect(mockPrepare).toHaveBeenCalledTimes(2); // SELECT + UPDATE
      expect(res.beforeDiff).toEqual({ name: 'Old name', propose_fixes: 0 });
      expect(res.afterDiff).toEqual({ name: 'New name', propose_fixes: 1 });
      expect(res.updated).toBe(true);
    });
  });

  describe('deleteProject', () => {
    it('throws TypeError if projectId is not a string', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.deleteProject(123 as any)).rejects.toThrow(TypeError);
    });

    it('deletes project via batch', async () => {
      const repo = new ProjectRepository(mockEnv);
      await repo.deleteProject('p1');
      expect(mockBatch).toHaveBeenCalled();
    });
  });

  describe('getProjectAnalytics', () => {
    it('computes analytics for period "24h"', async () => {
      mockAll.mockResolvedValueOnce({ total_scans: 10 }); // stats query
      mockAll.mockResolvedValueOnce({ results: [] }); // scan history
      mockAll.mockResolvedValueOnce({ results: [] }); // findings level
      mockAll.mockResolvedValueOnce({ results: [] }); // findings history

      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjectAnalytics('p1', null, '24h');
      expect(res.scanStats.total).toBe(10);
      expect(mockStub.fetch).toHaveBeenCalled();
      expect(res.runnerMetrics.totalConnected).toBe(1);
    });

    it('computes analytics for period "12w"', async () => {
      mockAll.mockResolvedValueOnce(null); // stats
      mockAll.mockResolvedValueOnce({ results: [] });
      mockAll.mockResolvedValueOnce({ results: [] });
      mockAll.mockResolvedValueOnce({ results: [] });

      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjectAnalytics('p1', null, '12w');
      expect(res.scanStats.total).toBe(0);
    });

    it('computes analytics for period "12m"', async () => {
      mockAll.mockResolvedValueOnce(null); // stats
      mockAll.mockResolvedValueOnce({ results: [] });
      mockAll.mockResolvedValueOnce({ results: [] });
      mockAll.mockResolvedValueOnce({ results: [] });

      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjectAnalytics('p1', null, '12m');
      expect(res.scanStats.total).toBe(0);
    });

    it('handles failing DO stub connection gracefully', async () => {
      mockAll.mockResolvedValueOnce(null);
      mockAll.mockResolvedValueOnce({ results: [] });
      mockAll.mockResolvedValueOnce({ results: [] });
      mockAll.mockResolvedValueOnce({ results: [] });
      mockStub.fetch.mockRejectedValue(new Error('DO offline'));

      const spyConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjectAnalytics('p1', null, '30d');
      expect(res.runnerMetrics.totalConnected).toBe(0);
      expect(spyConsoleError).toHaveBeenCalled();
      spyConsoleError.mockRestore();
    });
  });

  describe('checkUserIsMember', () => {
    it('returns membership status', async () => {
      mockAll.mockResolvedValueOnce({ role: 'member' });
      const repo = new ProjectRepository(mockEnv);
      expect(await repo.checkUserIsMember('p1', 'u1')).toBe(true);

      mockAll.mockResolvedValueOnce(undefined);
      expect(await repo.checkUserIsMember('p1', 'u1')).toBe(false);
    });
  });

  describe('getUserLoginHistory', () => {
    it('returns login history and pagination metadata', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'lh1' }] });
      mockAll.mockResolvedValueOnce({ total: 15 });

      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getUserLoginHistory('u1', 1, 10);
      expect(res.history).toEqual([{ id: 'lh1' }]);
      expect(res.pagination.total).toBe(15);
      expect(res.pagination.pages).toBe(2);
    });
  });

  describe('getProjectAuditLogs', () => {
    it('queries audit logs with active filters', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'al1' }] });
      mockAll.mockResolvedValueOnce({ total: 50 });

      const repo = new ProjectRepository(mockEnv);
      const res = await repo.getProjectAuditLogs('p1', 2, 10, 'search-term', 'web', 'action-term');
      expect(res.logs).toEqual([{ id: 'al1' }]);
      expect(res.pagination.total).toBe(50);
      expect(res.pagination.page).toBe(2);
    });
  });

  describe('getProjectWebhooks', () => {
    it('throws TypeError if projectId is not a string', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.getProjectWebhooks(123 as any)).rejects.toThrow(TypeError);
    });

    it('returns webhook rows', async () => {
      mockAll.mockResolvedValueOnce({ results: [{ id: 'w1' }] });
      const repo = new ProjectRepository(mockEnv);
      expect(await repo.getProjectWebhooks('p1')).toEqual([{ id: 'w1' }]);
    });
  });

  describe('getProjectWebhook', () => {
    it('throws TypeError if webhookId is not a string', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.getProjectWebhook(123 as any)).rejects.toThrow(TypeError);
    });

    it('returns webhook object or null', async () => {
      mockAll.mockResolvedValueOnce({ id: 'w1' });
      const repo = new ProjectRepository(mockEnv);
      expect(await repo.getProjectWebhook('w1')).toEqual({ id: 'w1' });

      mockAll.mockResolvedValueOnce(undefined);
      expect(await repo.getProjectWebhook('w1')).toBeNull();
    });
  });

  describe('createProjectWebhook', () => {
    it('throws TypeErrors for invalid arguments', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.createProjectWebhook(123 as any, 'p', 'url', null, 'evt')).rejects.toThrow(TypeError);
      await expect(repo.createProjectWebhook('id', 123 as any, 'url', null, 'evt')).rejects.toThrow(TypeError);
      await expect(repo.createProjectWebhook('id', 'p', 123 as any, null, 'evt')).rejects.toThrow(TypeError);
      await expect(repo.createProjectWebhook('id', 'p', 'url', 123 as any, 'evt')).rejects.toThrow(TypeError);
      await expect(repo.createProjectWebhook('id', 'p', 'url', null, 123 as any)).rejects.toThrow(TypeError);
    });

    it('inserts project webhook record', async () => {
      const repo = new ProjectRepository(mockEnv);
      await repo.createProjectWebhook('w1', 'p1', 'http://hook.io', 'headers', 'events');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO project_webhooks'));
    });
  });

  describe('updateProjectWebhook', () => {
    it('throws TypeErrors for invalid arguments', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.updateProjectWebhook(123 as any, 'url', null, 'evt')).rejects.toThrow(TypeError);
      await expect(repo.updateProjectWebhook('id', 123 as any, null, 'evt')).rejects.toThrow(TypeError);
      await expect(repo.updateProjectWebhook('id', 'url', 123 as any, 'evt')).rejects.toThrow(TypeError);
      await expect(repo.updateProjectWebhook('id', 'url', null, 123 as any)).rejects.toThrow(TypeError);
    });

    it('updates project webhook record', async () => {
      const repo = new ProjectRepository(mockEnv);
      await repo.updateProjectWebhook('w1', 'http://hook.io', 'headers', 'events');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE project_webhooks'));
    });
  });

  describe('deleteProjectWebhook', () => {
    it('throws TypeError if id is not a string', async () => {
      const repo = new ProjectRepository(mockEnv);
      await expect(repo.deleteProjectWebhook(123 as any)).rejects.toThrow(TypeError);
    });

    it('deletes project webhook record', async () => {
      const repo = new ProjectRepository(mockEnv);
      await repo.deleteProjectWebhook('w1');
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM project_webhooks'));
    });
  });
});
