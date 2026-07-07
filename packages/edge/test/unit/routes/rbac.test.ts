import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerRbacRoutes } from '../../../src/routes/rbac';
import { IRbacService } from '../../../src/services/rbac';

// Mock auth utils and middleware
vi.mock('../../../src/utils/auth', () => ({
  getUserIdFromRequest: vi.fn().mockResolvedValue('user_123'),
}));

vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: () => async (c: any, next: any) => {
    await next();
  },
}));

vi.mock('../../../src/middleware/auditLog', () => ({
  auditLog: () => async (c: any, next: any) => {
    await next();
  },
}));

describe('RBAC Routes Unit Tests', () => {
  let app: Hono<any>;
  let mockServices: Partial<IRbacService>;

  beforeEach(() => {
    mockServices = {
      getPermissions: vi.fn().mockReturnValue({ permissions: { 'read': 'Read access' } }),
      getRoles: vi.fn(),
      createCustomRole: vi.fn(),
      getMembers: vi.fn(),
      updateMemberRoles: vi.fn(),
      removeMember: vi.fn(),
      updateCustomRole: vi.fn(),
      deleteCustomRole: vi.fn(),
      getInvitations: vi.fn(),
      createInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
      declineInvitation: vi.fn(),
    };

    const mockFactory = () => mockServices as IRbacService;
    app = new Hono();
    registerRbacRoutes(app, mockFactory);
  });

  it('GET /api/projects/:id/permissions should return permissions', async () => {
    const res = await app.request('/api/projects/p123/permissions');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ permissions: { 'read': 'Read access' } });
  });

  it('GET /api/projects/:id/roles should return roles', async () => {
    (mockServices.getRoles as any).mockResolvedValue({ roles: [] });
    const res = await app.request('/api/projects/p123/roles');
    expect(res.status).toBe(200);
    expect(mockServices.getRoles).toHaveBeenCalledWith('p123');
  });

  it('POST /api/projects/:id/roles should create role', async () => {
    (mockServices.createCustomRole as any).mockResolvedValue({ status: 'created', id: 'c_123' });
    const res = await app.request('/api/projects/p123/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'custom' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'created', id: 'c_123' });
  });

  it('PUT /api/projects/:id/members/:user_id should update member roles', async () => {
    (mockServices.updateMemberRoles as any).mockResolvedValue({ status: 'updated' });
    const res = await app.request('/api/projects/p123/members/m123', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: ['editor'] }),
    });
    expect(res.status).toBe(200);
    expect(mockServices.updateMemberRoles).toHaveBeenCalledWith('p123', 'user_123', 'm123', { roles: ['editor'] });
  });

  it('DELETE /api/projects/:id/members/:user_id should remove member', async () => {
    (mockServices.removeMember as any).mockResolvedValue({ status: 'removed' });
    const res = await app.request('/api/projects/p123/members/m123', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(mockServices.removeMember).toHaveBeenCalledWith('p123', 'user_123', 'm123');
  });
});
