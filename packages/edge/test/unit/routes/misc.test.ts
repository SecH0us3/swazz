import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerMiscRoutes } from '../../../src/routes/misc';
import { IMiscService } from '../../../src/services/misc';

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
});
