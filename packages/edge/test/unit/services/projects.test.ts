import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectService } from '../../../src/services/projects';

const mockCheckUsernameExists = vi.fn();

vi.mock('../../../src/repositories/auth', () => {
  return {
    AuthRepository: vi.fn().mockImplementation(function() {
      return {
        checkUsernameExists: mockCheckUsernameExists,
      };
    }),
  };
});

describe('ProjectService', () => {
  let service: ProjectService;
  let env: any;
  let projectRepo: any;
  let rbacRepo: any;

  beforeEach(() => {
    mockCheckUsernameExists.mockReset();
    const mockPrepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
    });
    env = {
      DB: {
        prepare: mockPrepare,
        batch: vi.fn().mockResolvedValue([]),
      }
    };
    projectRepo = {
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
      getProjectAuditLogs: vi.fn()
    };
    rbacRepo = {
      checkPermission: vi.fn(),
      checkCustomRolesExist: vi.fn()
    };
    service = new ProjectService(env, projectRepo, rbacRepo);
  });

  describe('getProjects', () => {
    it('throws Unauthorized if auth enabled and no user', async () => {
      await expect(service.getProjects(null, true)).rejects.toThrow('Unauthorized|401');
    });

    it('returns projects', async () => {
      projectRepo.getProjects.mockResolvedValue([{ id: 'p1' }]);
      const res = await service.getProjects('u1', true);
      expect(res.projects).toEqual([{ id: 'p1' }]);
    });
  });

  describe('createProject', () => {
    it('throws Unauthorized if auth enabled and no user', async () => {
      await expect(service.createProject(null, true, {})).rejects.toThrow('Unauthorized|401');
    });

    it('uses anonymous user if auth disabled and no user', async () => {
      projectRepo.createProject.mockResolvedValue({ id: 'p1' });
      const res = await service.createProject(null, false, {});
      expect(res).toEqual({ id: 'p1', status: 'created' });
      expect(projectRepo.createProject).toHaveBeenCalledWith('anonymous', {});
    });

    it('creates project with user', async () => {
      projectRepo.createProject.mockResolvedValue({ id: 'p1' });
      const res = await service.createProject('u1', true, {});
      expect(res).toEqual({ id: 'p1', status: 'created' });
    });
  });

  describe('getProjectConfig and saveProjectConfig', () => {
    it('gets config', async () => {
      projectRepo.getProjectConfig.mockResolvedValue({ c: 1 });
      expect(await service.getProjectConfig('p1')).toEqual({ c: 1 });
    });

    it('saves config', async () => {
      projectRepo.saveProjectConfig.mockResolvedValue(undefined);
      expect(await service.saveProjectConfig('p1', { c: 2 })).toEqual({ status: 'saved' });
    });
  });

  describe('updateProjectSchedule', () => {
    it('throws if cron_schedule is not a string', async () => {
      await expect(service.updateProjectSchedule('p1', { cron_schedule: 123 })).rejects.toThrow('cron_schedule must be a string|400');
    });

    it('throws if invalid parts', async () => {
      await expect(service.updateProjectSchedule('p1', { cron_schedule: '* * * *' })).rejects.toThrow('Invalid cron format. Must have exactly 5 fields.|400');
    });

    it('throws if too frequent (not single minute/hour constants)', async () => {
      await expect(service.updateProjectSchedule('p1', { cron_schedule: '*/5 * * * *' })).rejects.toThrow('Scan schedule cannot be more frequent than once a day');
      await expect(service.updateProjectSchedule('p1', { cron_schedule: '0 */2 * * *' })).rejects.toThrow('Scan schedule cannot be more frequent than once a day');
    });

    it('updates schedule if valid', async () => {
      projectRepo.updateProjectSchedule.mockResolvedValue({ oldSchedule: null });
      const res = await service.updateProjectSchedule('p1', { cron_schedule: '30 2 * * *' });
      expect(res.status).toBe('saved');
      expect(res.cron_schedule).toBe('30 2 * * *');
    });
  });

  describe('updateProjectSettings', () => {
    it('returns without audit details if not updated', async () => {
      projectRepo.updateProjectSettings.mockResolvedValue({ updated: false });
      expect(await service.updateProjectSettings('p1', {})).toEqual({ status: 'updated' });
    });

    it('returns audit details if updated', async () => {
      projectRepo.updateProjectSettings.mockResolvedValue({ updated: true, beforeDiff: {}, afterDiff: { s: 1 } });
      const res = await service.updateProjectSettings('p1', {});
      expect(res.auditDetails.after).toEqual({ s: 1 });
    });
  });

  describe('deleteProject', () => {
    it('deletes project', async () => {
      projectRepo.deleteProject.mockResolvedValue(undefined);
      expect(await service.deleteProject('p1')).toEqual({ status: 'deleted' });
    });
  });

  describe('getProjectAnalytics', () => {
    it('throws Unauthorized if no user and auth enabled', async () => {
      await expect(service.getProjectAnalytics('p1', null, 'month', true)).rejects.toThrow('Unauthorized|401');
    });

    it('throws Forbidden if no permission', async () => {
      rbacRepo.checkPermission.mockResolvedValue(false);
      await expect(service.getProjectAnalytics('p1', 'u1', 'month', true)).rejects.toThrow('Forbidden|403');
    });

    it('returns analytics', async () => {
      rbacRepo.checkPermission.mockResolvedValue(true);
      projectRepo.getProjectAnalytics.mockResolvedValue({ count: 1 });
      expect(await service.getProjectAnalytics('p1', 'u1', 'month', true)).toEqual({ count: 1 });
    });
  });

  describe('getUserLoginHistory', () => {
    it('throws if not member', async () => {
      projectRepo.checkUserIsMember.mockResolvedValue(false);
      await expect(service.getUserLoginHistory('p1', 'u1', '1', '10')).rejects.toThrow('User is not a member of this project|404');
    });

    it('returns history with parsing constraints', async () => {
      projectRepo.checkUserIsMember.mockResolvedValue(true);
      projectRepo.getUserLoginHistory.mockResolvedValue([]);
      await service.getUserLoginHistory('p1', 'u1', '-1', '2000');
      expect(projectRepo.getUserLoginHistory).toHaveBeenCalledWith('u1', 1, 1000);
    });
  });

  describe('getProjectAuditLogs', () => {
    it('parses and cleans queries', async () => {
      projectRepo.getProjectAuditLogs.mockResolvedValue([]);
      await service.getProjectAuditLogs('p1', 'a', '-5', '  term  ', '', null as any);
      expect(projectRepo.getProjectAuditLogs).toHaveBeenCalledWith('p1', 1, 1, 'term', '', '');
    });
  });

  describe('createProjectMemberAccount', () => {
    it('throws if username is not a string', async () => {
      await expect(service.createProjectMemberAccount('p1', { username: 123 })).rejects.toThrow('Username is required|400');
    });

    it('throws if username is invalid', async () => {
      await expect(service.createProjectMemberAccount('p1', { username: 'ab' })).rejects.toThrow('Username must be 3-20 characters long');
      await expect(service.createProjectMemberAccount('p1', { username: 'a'.repeat(21) })).rejects.toThrow('Username must be 3-20 characters long');
      await expect(service.createProjectMemberAccount('p1', { username: 'user name' })).rejects.toThrow('Username must be 3-20 characters long');
    });

    it('throws if email is invalid', async () => {
      await expect(service.createProjectMemberAccount('p1', { username: 'user123', email: 'invalid' })).rejects.toThrow('Invalid email format|400');
    });

    it('throws if roles is not assigned or not an array', async () => {
      await expect(service.createProjectMemberAccount('p1', { username: 'user123', roles: 'editor' })).rejects.toThrow('At least one role must be assigned|400');
      await expect(service.createProjectMemberAccount('p1', { username: 'user123', roles: [] })).rejects.toThrow('At least one role must be assigned|400');
    });

    it('throws if custom roles are invalid', async () => {
      rbacRepo.checkCustomRolesExist.mockResolvedValue([]);
      await expect(service.createProjectMemberAccount('p1', { username: 'user123', roles: ['custom-role'] })).rejects.toThrow('One or more custom roles are invalid|400');
    });

    it('throws if username already exists', async () => {
      mockCheckUsernameExists.mockResolvedValue(true);
      await expect(service.createProjectMemberAccount('p1', { username: 'user123', roles: ['editor'] })).rejects.toThrow('Username already exists|400');
    });

    it('successfully provisions interactive user', async () => {
      mockCheckUsernameExists.mockResolvedValue(false);
      rbacRepo.checkCustomRolesExist.mockResolvedValue(['custom-role']);

      const res = await service.createProjectMemberAccount('p1', {
        username: 'newuser',
        email: 'test@example.com',
        roles: ['editor', 'custom-role'],
        is_interactive: true
      });

      expect(res.status).toBe('ok');
      expect(res.username).toBe('newuser');
      expect(res.password).toBeDefined();
      expect(res.password.length).toBe(16);
      expect(env.DB.batch).toHaveBeenCalled();
    });

    it('successfully provisions service account', async () => {
      mockCheckUsernameExists.mockResolvedValue(false);

      const res = await service.createProjectMemberAccount('p1', {
        username: 'service-acc',
        roles: ['viewer'],
        is_interactive: false
      });

      expect(res.status).toBe('ok');
      expect(res.username).toBe('service-acc');
      expect(res.api_key).toBeDefined();
      expect(res.api_key.startsWith('swazz_live_')).toBe(true);
      expect(env.DB.batch).toHaveBeenCalled();
    });
  });
});
