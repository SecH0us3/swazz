import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScansService } from '../../../src/services/scans';
import { Env } from '../../../src/env';
import * as jwt from 'hono/jwt';

vi.mock('hono/jwt', () => ({
  sign: vi.fn(),
  verify: vi.fn(),
}));

describe('ScansService Unit Tests', () => {
  let scansService: ScansService;
  let mockEnv: any;
  let mockScansRepo: any;
  let mockRbacRepo: any;

  beforeEach(() => {
    mockEnv = {
      JWT_SECRET: 'secret',
      SCAN_QUEUE: {
        send: vi.fn(),
      },
      STORAGE: {
        put: vi.fn(),
      },
    };

    mockScansRepo = {
      createScan: vi.fn(),
      getUserPublicKey: vi.fn(),
      getUserDetails: vi.fn(),
      getProjectMemberRole: vi.fn(),
      createAuditLog: vi.fn(),
      getScans: vi.fn(),
      getScan: vi.fn(),
      updateScan: vi.fn(),
      updateScanReportUrl: vi.fn(),
      getRunnerLogs: vi.fn(),
      getFindings: vi.fn(),
      getFindingDetails: vi.fn(),
      updateFinding: vi.fn(),
    };

    mockRbacRepo = {
      checkPermission: vi.fn().mockResolvedValue(true),
    };

    scansService = new ScansService(mockEnv as unknown as Env, mockScansRepo, mockRbacRepo);
    vi.clearAllMocks();
  });

  describe('createScan', () => {
    it('throws if missing required fields', async () => {
      await expect(scansService.createScan({}, 'u1', '', '1.1.1.1')).rejects.toThrow('Missing required fields: project_id, target_url, profile|400');
    });

    it('throws if no access', async () => {
      mockRbacRepo.checkPermission.mockResolvedValueOnce(false);
      await expect(scansService.createScan({ project_id: 'p1', target_url: 'u', profile: 'p' }, 'u1', '', '1.1.1.1')).rejects.toThrow('Forbidden|403');
    });

    it('creates scan successfully', async () => {
      mockScansRepo.getUserPublicKey.mockResolvedValueOnce('pubkey');
      mockScansRepo.getUserDetails.mockResolvedValueOnce({ username: 'test' });
      const waitUntil = vi.fn();
      
      const res = await scansService.createScan(
        { project_id: 'p1', target_url: 'u', profile: 'p' },
        'u1',
        'Bearer swazz_live_abc',
        '1.1.1.1',
        waitUntil
      );

      expect(res.status).toBe('queued');
      expect(mockScansRepo.createScan).toHaveBeenCalledWith(expect.any(String), 'p1', 'u', 'p', 'queued', 'u1', 'manual');
      expect(mockEnv.SCAN_QUEUE.send).toHaveBeenCalled();
      expect(waitUntil).toHaveBeenCalled();
    });

    it('creates scheduled scan successfully', async () => {
      mockScansRepo.getUserPublicKey.mockResolvedValueOnce('pubkey');
      mockScansRepo.getUserDetails.mockResolvedValueOnce({ username: 'test' });
      const waitUntil = vi.fn();
      
      const res = await scansService.createScan(
        { project_id: 'p1', target_url: 'u', profile: 'p', trigger_type: 'scheduled' },
        'u1',
        'Bearer swazz_live_abc',
        '1.1.1.1',
        waitUntil
      );

      expect(res.status).toBe('queued');
      expect(mockScansRepo.createScan).toHaveBeenCalledWith(expect.any(String), 'p1', 'u', 'p', 'queued', 'u1', 'scheduled');
      expect(mockEnv.SCAN_QUEUE.send).toHaveBeenCalled();
    });

    it('covers audit logic without waituntil and handles user details db error', async () => {
      mockScansRepo.getUserPublicKey.mockRejectedValueOnce(new Error('db err'));
      mockScansRepo.getUserDetails.mockRejectedValueOnce(new Error('audit err'));
      const res = await scansService.createScan(
        { project_id: 'p1', target_url: 'u', profile: 'p' },
        'u1',
        'auth',
        '1.1.1.1'
      );
      expect(res.status).toBe('queued');
      // wait a bit for fire and forget
      await new Promise(r => setTimeout(r, 10));
    });
  });

  describe('getScans', () => {
    it('throws if no projectId', async () => {
      await expect(scansService.getScans('', 'u1')).rejects.toThrow('Missing query parameter: project_id|400');
    });

    it('throws if no access', async () => {
      mockRbacRepo.checkPermission.mockResolvedValueOnce(false);
      await expect(scansService.getScans('p1', 'u1')).rejects.toThrow('Forbidden|403');
    });

    it('returns scans', async () => {
      mockScansRepo.getScans.mockResolvedValueOnce([{ id: 's1' }]);
      const res = await scansService.getScans('p1', 'u1');
      expect(res.scans).toEqual([{ id: 's1' }]);
    });
  });

  describe('getScan', () => {
    it('throws if not found', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce(null);
      await expect(scansService.getScan('s1', 'u1')).rejects.toThrow('Scan not found|404');
    });

    it('throws if no access', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ project_id: 'p1' });
      mockRbacRepo.checkPermission.mockResolvedValueOnce(false);
      await expect(scansService.getScan('s1', 'u1')).rejects.toThrow('Forbidden|403');
    });

    it('returns scan', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ id: 's1', project_id: 'p1' });
      const res = await scansService.getScan('s1', 'u1');
      expect(res.scan.id).toBe('s1');
    });
  });

  describe('updateScan', () => {
    it('throws if not found', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce(null);
      await expect(scansService.updateScan('s1', {}, 'u1')).rejects.toThrow('Scan not found|404');
    });

    it('throws if no access', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ project_id: 'p1' });
      mockRbacRepo.checkPermission.mockResolvedValueOnce(false);
      await expect(scansService.updateScan('s1', {}, 'u1')).rejects.toThrow('Forbidden|403');
    });

    it('updates scan', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ id: 's1', project_id: 'p1' });
      mockScansRepo.updateScan.mockResolvedValueOnce({ id: 's1', status: 'done' });
      const res = await scansService.updateScan('s1', {}, 'u1');
      expect(res.scan.status).toBe('done');
    });
  });

  describe('generateUploadUrl', () => {
    it('throws if not found', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce(null);
      await expect(scansService.generateUploadUrl('s1', 'u1')).rejects.toThrow('Scan not found|404');
    });

    it('throws if no access', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ project_id: 'p1' });
      mockRbacRepo.checkPermission.mockResolvedValueOnce(false);
      await expect(scansService.generateUploadUrl('s1', 'u1')).rejects.toThrow('Forbidden|403');
    });

    it('throws if secret missing', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ project_id: 'p1' });
      mockEnv.JWT_SECRET = '';
      await expect(scansService.generateUploadUrl('s1', 'u1')).rejects.toThrow('Internal server error: auth not configured|500');
    });

    it('generates url', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ project_id: 'p1' });
      (jwt.sign as any).mockResolvedValueOnce('token123');
      const res = await scansService.generateUploadUrl('s1', 'u1');
      expect(res.upload_token).toBe('token123');
    });
  });

  describe('uploadReport', () => {
    it('throws if no token', async () => {
      await expect(scansService.uploadReport('s1', undefined, null)).rejects.toThrow('Missing X-Upload-Token header|401');
    });

    it('throws if missing secret', async () => {
      mockEnv.JWT_SECRET = '';
      await expect(scansService.uploadReport('s1', 't', null)).rejects.toThrow('Internal server error: auth not configured|500');
    });

    it('throws if verify fails', async () => {
      (jwt.verify as any).mockRejectedValueOnce(new Error('expired'));
      await expect(scansService.uploadReport('s1', 't', null)).rejects.toThrow('Upload token expired|401');
    });

    it('throws if invalid token purpose', async () => {
      (jwt.verify as any).mockResolvedValueOnce({ purpose: 'other', scan_id: 's1' });
      await expect(scansService.uploadReport('s1', 't', null)).rejects.toThrow('Token does not match this scan|403');
    });

    it('throws if no stream', async () => {
      (jwt.verify as any).mockResolvedValueOnce({ purpose: 'upload', scan_id: 's1' });
      await expect(scansService.uploadReport('s1', 't', null)).rejects.toThrow('Empty body|400');
    });

    it('throws random verify errors', async () => {
      (jwt.verify as any).mockRejectedValueOnce(new Error('Custom|403'));
      await expect(scansService.uploadReport('s1', 't', null)).rejects.toThrow('Custom|403');
    });

    it('throws general verify error fallback', async () => {
      (jwt.verify as any).mockRejectedValueOnce(new Error('general'));
      await expect(scansService.uploadReport('s1', 't', null)).rejects.toThrow('Invalid upload token|403');
    });

    it('uploads report', async () => {
      (jwt.verify as any).mockResolvedValueOnce({ purpose: 'upload', scan_id: 's1', r2_key: 'key' });
      const stream = new ReadableStream();
      const res = await scansService.uploadReport('s1', 't', stream);
      expect(res.status).toBe('uploaded');
      expect(mockEnv.STORAGE.put).toHaveBeenCalledWith('key', stream, expect.any(Object));
      expect(mockScansRepo.updateScanReportUrl).toHaveBeenCalledWith('s1', 'key');
    });
  });

  describe('checkScanAccess', () => {
    it('returns immediately if auth not enabled', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ id: 's1' });
      mockScansRepo.getRunnerLogs.mockResolvedValueOnce([]);
      await scansService.getRunnerLogs('s1', null, false);
      expect(mockScansRepo.getRunnerLogs).toHaveBeenCalled();
    });

    it('throws if auth enabled but no user', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ id: 's1' });
      await expect(scansService.getRunnerLogs('s1', null, true)).rejects.toThrow('Unauthorized|401');
    });

    it('checks user_id if no project_id', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ id: 's1', user_id: 'other' });
      await expect(scansService.getRunnerLogs('s1', 'u1', true)).rejects.toThrow('Forbidden|403');
      
      mockScansRepo.getScan.mockResolvedValueOnce({ id: 's1', user_id: 'u1' });
      await scansService.getRunnerLogs('s1', 'u1', true);
      expect(mockScansRepo.getRunnerLogs).toHaveBeenCalled();
    });

    it('checks rbac if project_id exists', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ id: 's1', project_id: 'p1' });
      mockRbacRepo.checkPermission.mockResolvedValueOnce(false);
      await expect(scansService.getRunnerLogs('s1', 'u1', true)).rejects.toThrow('Forbidden|403');
    });
  });

  describe('getRunnerLogs', () => {
    it('throws if not found', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce(null);
      await expect(scansService.getRunnerLogs('s1', 'u1', false)).rejects.toThrow('Scan not found|404');
    });

    it('returns logs', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ id: 's1' });
      mockScansRepo.getRunnerLogs.mockResolvedValueOnce([]);
      const res = await scansService.getRunnerLogs('s1', 'u1', false);
      expect(res.logs).toEqual([]);
    });
  });

  describe('getFindings', () => {
    it('throws if not found', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce(null);
      await expect(scansService.getFindings('s1', 'u1', false)).rejects.toThrow('Scan not found|404');
    });

    it('returns findings', async () => {
      mockScansRepo.getScan.mockResolvedValueOnce({ id: 's1' });
      mockScansRepo.getFindings.mockResolvedValueOnce([]);
      const res = await scansService.getFindings('s1', 'u1', false);
      expect(res.findings).toEqual([]);
    });
  });

  describe('getFindingDetails', () => {
    it('throws if not found', async () => {
      mockScansRepo.getFindingDetails.mockResolvedValueOnce(null);
      await expect(scansService.getFindingDetails('f1', 'u1', false)).rejects.toThrow('Finding not found|404');
    });

    it('returns finding', async () => {
      mockScansRepo.getFindingDetails.mockResolvedValueOnce({ id: 'f1' });
      const res = await scansService.getFindingDetails('f1', 'u1', false);
      expect(res.finding.id).toBe('f1');
    });
  });

  describe('updateFinding', () => {
    it('throws if not found', async () => {
      mockScansRepo.getFindingDetails.mockResolvedValueOnce(null);
      await expect(scansService.updateFinding('f1', {}, 'u1', false)).rejects.toThrow('Finding not found|404');
    });

    it('throws if auth enabled and no user', async () => {
      mockScansRepo.getFindingDetails.mockResolvedValueOnce({ id: 'f1' });
      await expect(scansService.updateFinding('f1', {}, null, true)).rejects.toThrow('Unauthorized|401');
    });

    it('checks user_id if no project_id', async () => {
      mockScansRepo.getFindingDetails.mockResolvedValueOnce({ id: 'f1', user_id: 'other' });
      await expect(scansService.updateFinding('f1', {}, 'u1', true)).rejects.toThrow('Forbidden|403');
    });

    it('checks rbac if project_id exists', async () => {
      mockScansRepo.getFindingDetails.mockResolvedValueOnce({ id: 'f1', project_id: 'p1' });
      mockRbacRepo.checkPermission.mockResolvedValueOnce(false);
      await expect(scansService.updateFinding('f1', {}, 'u1', true)).rejects.toThrow('Forbidden|403');
    });

    it('updates finding', async () => {
      mockScansRepo.getFindingDetails.mockResolvedValueOnce({ id: 'f1' });
      mockScansRepo.updateFinding.mockResolvedValueOnce({ id: 'f1', updated: true });
      const res = await scansService.updateFinding('f1', {}, 'u1', false);
      expect(res.finding.updated).toBe(true);
    });
  });
});
