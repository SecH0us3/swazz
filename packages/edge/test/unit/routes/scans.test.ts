import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerScansRoutes } from '../../../src/routes/scans';
import { IScansService } from '../../../src/services/scans';

vi.mock('../../../src/utils/auth', () => ({
  getUserIdFromRequest: vi.fn().mockResolvedValue('user_123'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

describe('Scans Routes Unit Tests', () => {
  let app: Hono<any>;
  let mockServices: Partial<IScansService>;

  beforeEach(() => {
    mockServices = {
      createScan: vi.fn(),
      getScans: vi.fn(),
      getScan: vi.fn(),
      updateScan: vi.fn(),
      generateUploadUrl: vi.fn(),
      uploadReport: vi.fn(),
      getRunnerLogs: vi.fn(),
      getFindings: vi.fn(),
      getFindingDetails: vi.fn(),
      updateFinding: vi.fn(),
    };

    const mockFactory = () => mockServices as IScansService;
    app = new Hono();
    registerScansRoutes(app, mockFactory);
  });

  it('POST /api/scans should create scan', async () => {
    (mockServices.createScan as any).mockResolvedValue({ id: 'scan_123', status: 'queued' });
    const res = await app.request('/api/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'p123', target_url: 'http://example.com', profile: 'default' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'scan_123', status: 'queued' });
    expect(mockServices.createScan).toHaveBeenCalled();
  });

  it('GET /api/scans should fetch scans', async () => {
    (mockServices.getScans as any).mockResolvedValue({ scans: [] });
    const res = await app.request('/api/scans?project_id=p123');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scans: [] });
    expect(mockServices.getScans).toHaveBeenCalledWith('p123', 'user_123');
  });

  it('GET /api/scans/:id should fetch scan details', async () => {
    (mockServices.getScan as any).mockResolvedValue({ scan: { id: 's123' } });
    const res = await app.request('/api/scans/s123');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scan: { id: 's123' } });
    expect(mockServices.getScan).toHaveBeenCalledWith('s123', 'user_123');
  });
});
