import { describe, test, expect, vi, beforeEach } from 'vitest';
import { ScansService } from '../../../src/services/scans';
import { IScansRepository } from '../../../src/repositories/scans';
import { IRbacRepository } from '../../../src/repositories/rbac';
import { Env } from '../../../src/env';

describe('ScansService Unit Tests', () => {
  let scansService: ScansService;
  let mockEnv: Env;
  let mockScansRepo: any;
  let mockRbacRepo: any;

  beforeEach(() => {
    mockEnv = {
      SCAN_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
      STORAGE: {
        put: vi.fn().mockResolvedValue(undefined),
      },
      JWT_SECRET: 'test-secret',
    } as any;

    mockScansRepo = {
      createScan: vi.fn().mockResolvedValue(undefined),
      getUserPublicKey: vi.fn().mockResolvedValue('test-public-key'),
      getUserDetails: vi.fn().mockResolvedValue({ username: 'testuser' }),
      getProjectMemberRole: vi.fn().mockResolvedValue('owner'),
      createAuditLog: vi.fn().mockResolvedValue(undefined),
      getScans: vi.fn().mockResolvedValue([{ id: 'scan-1', status: 'completed' }]),
      getScan: vi.fn().mockResolvedValue({ id: 'scan-1', project_id: 'proj-1', user_id: 'user-1' }),
      updateScan: vi.fn().mockImplementation((scanId, body) => Promise.resolve({ id: scanId, ...body })),
      updateScanStatus: vi.fn().mockResolvedValue(undefined),
      updateScanReportUrl: vi.fn().mockResolvedValue(undefined),
      getRunnerLogs: vi.fn().mockResolvedValue([{ log: 'test log' }]),
      getFindings: vi.fn().mockResolvedValue([{ id: 'finding-1', type: 'BOLA' }]),
      getFindingDetails: vi.fn().mockResolvedValue({ id: 'finding-1', type: 'BOLA', project_id: 'proj-1' }),
      updateFinding: vi.fn().mockImplementation((findingId, body) => Promise.resolve({ id: findingId, triage_state: body.triage_state })),
    };

    mockRbacRepo = {
      checkPermission: vi.fn().mockResolvedValue(true),
    };

    scansService = new ScansService(mockEnv, mockScansRepo as IScansRepository, mockRbacRepo as IRbacRepository);
  });

  test('createScan should succeed with valid inputs', async () => {
    const res = await scansService.createScan(
      { project_id: 'proj-1', target_url: 'http://example.com', profile: 'default' },
      'user-1',
      'Bearer token',
      '127.0.0.1'
    );

    expect(res.status).toBe('queued');
    expect(mockScansRepo.createScan).toHaveBeenCalled();
    expect(mockEnv.SCAN_QUEUE.send).toHaveBeenCalled();
  });

  test('createScan should throw error if missing fields', async () => {
    await expect(
      scansService.createScan({ project_id: 'proj-1' }, 'user-1', 'Bearer token', '127.0.0.1')
    ).rejects.toThrow('Missing required fields');
  });

  test('createScan should throw error if user has no permission', async () => {
    mockRbacRepo.checkPermission.mockResolvedValue(false);

    await expect(
      scansService.createScan(
        { project_id: 'proj-1', target_url: 'http://example.com', profile: 'default' },
        'user-1',
        'Bearer token',
        '127.0.0.1'
      )
    ).rejects.toThrow('Forbidden|403');
  });

  test('getScans should return scans list', async () => {
    const res = await scansService.getScans('proj-1', 'user-1');
    expect(res.scans).toHaveLength(1);
    expect(mockRbacRepo.checkPermission).toHaveBeenCalledWith('user-1', 'proj-1', 'get:/api/projects/:id/scans');
  });

  test('getScans should throw if missing project_id', async () => {
    await expect(scansService.getScans('', 'user-1')).rejects.toThrow('Missing query parameter');
  });

  test('getScan should return scan details', async () => {
    const res = await scansService.getScan('scan-1', 'user-1');
    expect(res.scan.id).toBe('scan-1');
  });

  test('getScan should throw if scan not found', async () => {
    mockScansRepo.getScan.mockResolvedValue(null);
    await expect(scansService.getScan('scan-1', 'user-1')).rejects.toThrow('Scan not found|404');
  });

  test('updateScan should update scan details', async () => {
    const res = await scansService.updateScan('scan-1', { status: 'completed' }, 'user-1');
    expect(res.scan.status).toBe('completed');
    expect(mockScansRepo.updateScan).toHaveBeenCalled();
  });

  test('generateUploadUrl and uploadReport flow', async () => {
    const genRes = await scansService.generateUploadUrl('scan-1', 'user-1');
    expect(genRes.upload_token).toBeDefined();
    expect(genRes.r2_key).toBe('reports/scan-1.enc');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('report data'));
        controller.close();
      }
    });

    const uploadRes = await scansService.uploadReport('scan-1', genRes.upload_token, stream);
    expect(uploadRes.status).toBe('uploaded');
    expect(mockEnv.STORAGE.put).toHaveBeenCalled();
    expect(mockScansRepo.updateScanReportUrl).toHaveBeenCalled();
  });

  test('uploadReport should throw if token is missing', async () => {
    await expect(scansService.uploadReport('scan-1', undefined, null)).rejects.toThrow('Missing X-Upload-Token header');
  });

  test('getRunnerLogs should return logs', async () => {
    const res = await scansService.getRunnerLogs('scan-1', 'user-1', true);
    expect(res.logs).toHaveLength(1);
  });

  test('getFindings should return findings', async () => {
    const res = await scansService.getFindings('scan-1', 'user-1', true);
    expect(res.findings).toHaveLength(1);
  });

  test('getFindingDetails should return finding details', async () => {
    const res = await scansService.getFindingDetails('finding-1', 'user-1', true);
    expect(res.finding.id).toBe('finding-1');
  });

  test('updateFinding should update triage state', async () => {
    const res = await scansService.updateFinding('finding-1', { triage_state: 'ignored' }, 'user-1', true);
    expect(res.finding.triage_state).toBe('ignored');
    expect(mockScansRepo.updateFinding).toHaveBeenCalled();
  });
});
