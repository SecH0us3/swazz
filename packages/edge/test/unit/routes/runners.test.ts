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

  it('GET /api/runners should fetch runners', async () => {
    (mockServices.getRunners as any).mockResolvedValue({ runners: [] });
    const res = await app.request('/api/runners');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runners: [] });
    expect(mockServices.getRunners).toHaveBeenCalledWith('user_123');
  });

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

  it('POST /api/runs/:id/stop should stop scan', async () => {
    (mockServices.stopRun as any).mockResolvedValue({ status: 'stopped' });
    const res = await app.request('/api/runs/r123/stop', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'stopped' });
    expect(mockServices.stopRun).toHaveBeenCalledWith('r123', 'user_123');
  });
});
