import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerRunnersRoutes } from '../../../src/routes/runners';
import { IRunnersService } from '../../../src/services/runners';

vi.mock('../../../src/utils/auth', () => ({
  getUserIdFromRequest: vi.fn().mockResolvedValue('user_123'),
  isWebRequest: vi.fn().mockReturnValue(true),
  isAnonymousUser: vi.fn().mockResolvedValue(false),
}));

describe('Runners Routes Unit Tests', () => {
  let app: Hono<any>;
  let mockServices: Partial<IRunnersService>;

  beforeEach(() => {
    mockServices = {
      connect: vi.fn(),
      getRunners: vi.fn(),
      connectClient: vi.fn(),
      queueRun: vi.fn(),
      stopRun: vi.fn(),
      pauseRun: vi.fn(),
      resumeRun: vi.fn(),
      restartRunner: vi.fn(),
    };

    const mockFactory = () => mockServices as IRunnersService;
    app = new Hono();
    registerRunnersRoutes(app, mockFactory);
  });

  describe('GET /api/runners/connect', () => {
    it('returns response from connect', async () => {
      (mockServices.connect as any).mockResolvedValue(new Response('connected'));
      const res = await app.request('/api/runners/connect?token=abc');
      expect(await res.text()).toBe('connected');
    });

    it('returns error on connect failure', async () => {
      (mockServices.connect as any).mockRejectedValue(new Error('Auth failed|401'));
      const res = await app.request('/api/runners/connect');
      expect(res.status).toBe(401);
      expect(await res.text()).toBe('Auth failed');
    });

    it('returns 500 on default failure', async () => {
      (mockServices.connect as any).mockRejectedValue(new Error('Boom'));
      const res = await app.request('/api/runners/connect');
      expect(res.status).toBe(500);
      expect(await res.text()).toBe('Boom');
    });
  });

  describe('GET /api/runners', () => {
    it('GET /api/runners should fetch runners', async () => {
      (mockServices.getRunners as any).mockResolvedValue({ runners: [] });
      const res = await app.request('/api/runners');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ runners: [] });
      expect(mockServices.getRunners).toHaveBeenCalledWith('user_123');
    });

    it('returns error', async () => {
      (mockServices.getRunners as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/runners');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'fail' });
    });
  });

  describe('GET /api/runs/:id/events', () => {
    it('returns response from connectClient', async () => {
      (mockServices.connectClient as any).mockResolvedValue(new Response('connected'));
      const res = await app.request('/api/runs/r1/events');
      expect(await res.text()).toBe('connected');
    });

    it('returns error on connectClient failure', async () => {
      (mockServices.connectClient as any).mockRejectedValue(new Error('fail|404'));
      const res = await app.request('/api/runs/r1/events');
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('fail');
    });
  });

  describe('POST /api/runs', () => {
    it('POST /api/runs should queue scan run', async () => {
      (mockServices.queueRun as any).mockResolvedValue({ id: 'run_123', status: 'queued' });
      const res = await app.request('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: 'p123', config: {} }),
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ id: 'run_123', status: 'queued' });
      expect(mockServices.queueRun).toHaveBeenCalled();
    });

    it('returns error', async () => {
      (mockServices.queueRun as any).mockRejectedValue(new Error('fail|403'));
      const res = await app.request('/api/runs', { method: 'POST', body: '{}' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/runs/:id/stop', () => {
    it('POST /api/runs/:id/stop should stop scan', async () => {
      (mockServices.stopRun as any).mockResolvedValue({ status: 'stopped' });
      const res = await app.request('/api/runs/r123/stop', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'stopped' });
      expect(mockServices.stopRun).toHaveBeenCalledWith('r123', 'user_123');
    });

    it('returns error', async () => {
      (mockServices.stopRun as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/runs/r123/stop', { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/runs/:id/pause', () => {
    it('pauses scan', async () => {
      (mockServices.pauseRun as any).mockResolvedValue({ status: 'paused' });
      const res = await app.request('/api/runs/r123/pause', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'paused' });
      expect(mockServices.pauseRun).toHaveBeenCalledWith('r123', 'user_123');
    });

    it('returns error', async () => {
      (mockServices.pauseRun as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/runs/r123/pause', { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/runs/:id/resume', () => {
    it('resumes scan', async () => {
      (mockServices.resumeRun as any).mockResolvedValue({ status: 'resumed' });
      const res = await app.request('/api/runs/r123/resume', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'resumed' });
      expect(mockServices.resumeRun).toHaveBeenCalledWith('r123', 'user_123');
    });

    it('returns error', async () => {
      (mockServices.resumeRun as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/runs/r123/resume', { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/runners/:connectionId/restart', () => {
    it('restarts runner', async () => {
      (mockServices.restartRunner as any).mockResolvedValue({ status: 'restarting' });
      const res = await app.request('/api/runners/c123/restart', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'restarting' });
      expect(mockServices.restartRunner).toHaveBeenCalledWith('c123', 'user_123');
    });

    it('returns error', async () => {
      (mockServices.restartRunner as any).mockRejectedValue(new Error('fail|400'));
      const res = await app.request('/api/runners/c123/restart', { method: 'POST' });
      expect(res.status).toBe(400);
    });
  });
});
