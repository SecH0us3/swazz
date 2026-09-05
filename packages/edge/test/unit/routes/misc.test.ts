// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerMiscRoutes } from '../../../src/routes/misc';
import { IMiscService } from '../../../src/services/misc';

const mockRunWafCheck = vi.fn();
vi.mock('../../../src/services/wafCheck', () => ({
  runWafCheck: (...args: any[]) => mockRunWafCheck(...args),
}));

// Mock auth utils so we can test routes in isolation
vi.mock('../../../src/utils/auth', () => ({
  getUserIdFromRequest: vi.fn().mockResolvedValue('user_123'),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  isAnonymousUser: vi.fn().mockResolvedValue(false),
  isWebRequest: vi.fn().mockReturnValue(true),
}));

describe('Misc Routes', () => {
  let mockServices: Partial<IMiscService>;
  let app: Hono<any>;

  beforeEach(() => {
    mockRunWafCheck.mockReset();
    mockServices = {
      proxy: vi.fn(),
      parseSpec: vi.fn(),
    };

    const mockFactory = () => mockServices as IMiscService;

    app = new Hono();
    registerMiscRoutes(app, mockFactory);
  });

  describe('ALL /api/proxy', () => {
    it('should proxy call successfully', async () => {
      const mockResult = { status: 200, body: { ok: true } };
      (mockServices.proxy as any).mockResolvedValue(mockResult);

      const res = await app.request('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(mockResult);
      expect(mockServices.proxy).toHaveBeenCalledWith({ url: 'https://example.com' });
    });

    it('should propagate service errors with proper status code', async () => {
      (mockServices.proxy as any).mockRejectedValue(new Error('Missing target url|400'));

      const res = await app.request('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Missing target url' });
    });
  });

  describe('POST /api/parse', () => {
    it('should parse spec successfully', async () => {
      const mockResult = { status: 200, bodyText: JSON.stringify({ swagger: '2.0' }) };
      (mockServices.parseSpec as any).mockResolvedValue(mockResult);

      const res = await app.request('/api/parse', {
        method: 'POST',
        body: '{"swagger": "2.0"}',
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ swagger: '2.0' });
      expect(mockServices.parseSpec).toHaveBeenCalled();
    });

    it('should propagate limit or parse errors', async () => {
      (mockServices.parseSpec as any).mockRejectedValue(new Error('Anonymous limit reached|403'));

      const res = await app.request('/api/parse', {
        method: 'POST',
        body: '{"swagger": "2.0"}',
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Anonymous limit reached' });
    });
  });

  describe('POST /api/waf-check', () => {
    it('should handle success passthrough', async () => {
      const mockResult = {
        detection: { detected: true, wafType: 'Cloudflare', confidence: 0.9, evidence: [] },
        sensitiveFiles: { total: 0, results: [] },
      };
      mockRunWafCheck.mockResolvedValue(mockResult);

      const mockEnv = { WAF_CHECKER_URL: 'https://waf.secmy.app' };
      const res = await app.request('/api/waf-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      }, mockEnv);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(mockResult);
      expect(mockRunWafCheck).toHaveBeenCalledWith(mockEnv, 'https://example.com');
    });

    it('should reject missing or invalid target url with 400', async () => {
      const res1 = await app.request('/api/waf-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res1.status).toBe(400);
      expect(await res1.json()).toEqual({ error: 'Missing target url' });

      const res2 = await app.request('/api/waf-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 12345 }),
      });
      expect(res2.status).toBe(400);
      expect(await res2.json()).toEqual({ error: 'Missing target url' });
    });

    it('should propagate service errors with matching status code', async () => {
      mockRunWafCheck.mockRejectedValue(new Error('WAF check failed: Connection refused|502'));

      const res = await app.request('/api/waf-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'WAF check failed: Connection refused' });
    });
  });
});

