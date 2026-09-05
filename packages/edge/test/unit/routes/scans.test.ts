// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerScansRoutes } from '../../../src/routes/scans';
import { IScansService } from '../../../src/services/scans';

vi.mock('../../../src/utils/auth', () => ({
  getUserIdFromRequest: vi.fn().mockResolvedValue('user_123'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../../src/middleware/license', () => ({
  requireFeature: (feature: string) => async (c: any, next: any) => {
    const { getUserIdFromRequest } = await import('../../../src/utils/auth');
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (userId === 'unentitled_user') {
      return c.json({ error: `feature requires a paid plan (feature: ${feature})` }, 403);
    }
    await next();
  },
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
      saveWAFPatchReport: vi.fn(),
    };

    const mockFactory = () => mockServices as IScansService;
    app = new Hono();
    app.use('*', async (c, next) => {
      c.env = { AUTH_ENABLED: 'true' };
      await next();
    });
    registerScansRoutes(app, mockFactory);
  });

  describe('POST /api/scans', () => {
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

    it('returns error', async () => {
      (mockServices.createScan as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/scans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: 'p123', target_url: 'http://example.com', profile: 'default' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'fail' });
    });
  });

  describe('GET /api/scans', () => {
    it('GET /api/scans should fetch scans', async () => {
      (mockServices.getScans as any).mockResolvedValue({ scans: [] });
      const res = await app.request('/api/scans?project_id=p123');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ scans: [] });
      expect(mockServices.getScans).toHaveBeenCalledWith('p123', 'user_123');
    });

    it('returns error', async () => {
      (mockServices.getScans as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/scans?project_id=p123');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/scans/:id', () => {
    it('GET /api/scans/:id should fetch scan details', async () => {
      (mockServices.getScan as any).mockResolvedValue({ scan: { id: 's123' } });
      const res = await app.request('/api/scans/s123');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ scan: { id: 's123' } });
      expect(mockServices.getScan).toHaveBeenCalledWith('s123', 'user_123');
    });

    it('returns error', async () => {
      (mockServices.getScan as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/scans/s123');
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/scans/:id', () => {
    it('should update scan', async () => {
      (mockServices.updateScan as any).mockResolvedValue({ status: 'updated' });
      const res = await app.request('/api/scans/s123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'updated' });
      expect(mockServices.updateScan).toHaveBeenCalledWith('s123', { status: 'completed' }, 'user_123');
    });

    it('returns error', async () => {
      (mockServices.updateScan as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/scans/s123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/scans/:id/upload-url', () => {
    it('should generate upload url', async () => {
      (mockServices.generateUploadUrl as any).mockResolvedValue({ upload_url: 'http://upload' });
      const res = await app.request('/api/scans/s123/upload-url', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ upload_url: 'http://upload' });
      expect(mockServices.generateUploadUrl).toHaveBeenCalledWith('s123', 'user_123');
    });

    it('returns error', async () => {
      (mockServices.generateUploadUrl as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/scans/s123/upload-url', { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/scans/:id/upload', () => {
    it('should upload report directly', async () => {
      (mockServices.uploadReport as any).mockResolvedValue({ status: 'uploaded' });
      const res = await app.request('/api/scans/s123/upload', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Upload-Token': 'token123' },
        body: JSON.stringify({ report: 'data' })
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'uploaded' });
      expect(mockServices.uploadReport).toHaveBeenCalled();
    });

    it('returns error', async () => {
      (mockServices.uploadReport as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/scans/s123/upload', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: 'data' })
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/scans/:id/runner-logs', () => {
    it('should fetch runner logs', async () => {
      (mockServices.getRunnerLogs as any).mockResolvedValue({ logs: [] });
      const res = await app.request('/api/scans/s123/runner-logs');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ logs: [] });
      expect(mockServices.getRunnerLogs).toHaveBeenCalledWith('s123', 'user_123', true);
    });

    it('returns error', async () => {
      (mockServices.getRunnerLogs as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/scans/s123/runner-logs');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/scans/:id/findings', () => {
    it('should fetch findings', async () => {
      (mockServices.getFindings as any).mockResolvedValue({ findings: [] });
      const res = await app.request('/api/scans/s123/findings');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ findings: [] });
      expect(mockServices.getFindings).toHaveBeenCalledWith('s123', 'user_123', true);
    });

    it('returns error', async () => {
      (mockServices.getFindings as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/scans/s123/findings');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/findings/:id', () => {
    it('should fetch finding details', async () => {
      (mockServices.getFindingDetails as any).mockResolvedValue({ finding: { id: 'f1' } });
      const res = await app.request('/api/findings/f1');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ finding: { id: 'f1' } });
      expect(mockServices.getFindingDetails).toHaveBeenCalledWith('f1', 'user_123', true);
    });

    it('returns error', async () => {
      (mockServices.getFindingDetails as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/findings/f1');
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/findings/:id', () => {
    it('should update finding', async () => {
      (mockServices.updateFinding as any).mockResolvedValue({ status: 'updated', auditDetails: { foo: 'bar' } });
      const res = await app.request('/api/findings/f1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' })
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'updated', auditDetails: { foo: 'bar' } });
      expect(mockServices.updateFinding).toHaveBeenCalledWith('f1', { status: 'resolved' }, 'user_123', true, undefined);
    });

    it('returns error', async () => {
      (mockServices.updateFinding as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/findings/f1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' })
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/scans/:id/waf-patch', () => {
    it('should save WAF patch report successfully', async () => {
      (mockServices.saveWAFPatchReport as any).mockResolvedValue({ success: true });
      const report = { totalBypasses: 1, bundles: { cloudflare: { vendor: 'cloudflare', native: 'rule' } } };
      const res = await app.request('/api/scans/s123/waf-patch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(mockServices.saveWAFPatchReport).toHaveBeenCalledWith('s123', report, 'user_123', true);
    });

    it('returns error when service fails', async () => {
      (mockServices.saveWAFPatchReport as any).mockRejectedValue(new Error('Scan not found|404'));
      const res = await app.request('/api/scans/s123/waf-patch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Scan not found' });
    });

    it('does not require a paid license (free feature)', async () => {
      const { getUserIdFromRequest } = await import('../../../src/utils/auth');
      (getUserIdFromRequest as any).mockResolvedValueOnce('unentitled_user');
      (mockServices.saveWAFPatchReport as any).mockResolvedValue({ success: true });

      const res = await app.request('/api/scans/s123/waf-patch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
    });

    it('returns a structured error for a malformed JSON body', async () => {
      const res = await app.request('/api/scans/s123/waf-patch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      });
      expect(res.status).toBe(500);
      expect(await res.json()).toHaveProperty('error');
      expect(mockServices.saveWAFPatchReport).not.toHaveBeenCalled();
    });
  });
});
