import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { Env } from '../../../src/env';
import { registerRbacRoutes } from '../../../src/routes/rbac';
import { IRbacService } from '../../../src/services/rbac';

// Mock getUserIdFromRequest and middleware
vi.mock('../../../src/utils/auth', () => ({
  getUserIdFromRequest: vi.fn().mockResolvedValue('user123')
}));
vi.mock('../../../src/middleware/rbac', () => ({
  requirePermission: vi.fn(() => async (c: any, next: any) => await next())
}));
vi.mock('../../../src/middleware/auditLog', () => ({
  auditLog: vi.fn(() => async (c: any, next: any) => await next())
}));

describe('RBAC Routes Unit Tests', () => {
  let app: Hono<{ Bindings: Env; Variables: { auditDetails: any } }>;
  let mockRbacService: Record<keyof IRbacService, any>;

  beforeEach(() => {
    mockRbacService = {
      getPermissions: vi.fn(),
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
      declineInvitation: vi.fn()
    };

    app = new Hono<{ Bindings: Env; Variables: { auditDetails: any } }>();
    app.use('*', async (c, next) => {
      c.env = {} as any;
      await next();
    });

    registerRbacRoutes(app, () => mockRbacService as any);
  });

  describe('GET /api/projects/:id/permissions', () => {
    it('returns permissions', async () => {
      mockRbacService.getPermissions.mockReturnValue([{ id: 'p1' }]);
      const res = await app.request('/api/projects/proj1/permissions');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([{ id: 'p1' }]);
    });
  });

  describe('GET /api/projects/:id/roles', () => {
    it('returns roles', async () => {
      mockRbacService.getRoles.mockResolvedValue([{ id: 'r1' }]);
      const res = await app.request('/api/projects/proj1/roles');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([{ id: 'r1' }]);
    });
    it('handles error', async () => {
      mockRbacService.getRoles.mockRejectedValue(new Error('error'));
      const res = await app.request('/api/projects/proj1/roles');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/projects/:id/roles', () => {
    it('creates custom role', async () => {
      mockRbacService.createCustomRole.mockResolvedValue({ id: 'r1' });
      const res = await app.request('/api/projects/proj1/roles', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.createCustomRole.mockRejectedValue(new Error('err|400'));
      const res = await app.request('/api/projects/proj1/roles', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/projects/:id/members', () => {
    it('returns members', async () => {
      mockRbacService.getMembers.mockResolvedValue([{ id: 'm1' }]);
      const res = await app.request('/api/projects/proj1/members');
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.getMembers.mockRejectedValue(new Error('error'));
      const res = await app.request('/api/projects/proj1/members');
      expect(res.status).toBe(500);
    });
  });

  describe('PUT /api/projects/:id/members/:user_id', () => {
    it('updates member', async () => {
      mockRbacService.updateMemberRoles.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/projects/proj1/members/u1', { method: 'PUT', body: JSON.stringify({}) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.updateMemberRoles.mockRejectedValue(new Error('err|404'));
      const res = await app.request('/api/projects/proj1/members/u1', { method: 'PUT', body: JSON.stringify({}) });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/projects/:id/members/:user_id', () => {
    it('deletes member', async () => {
      mockRbacService.removeMember.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/projects/proj1/members/u1', { method: 'DELETE' });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.removeMember.mockRejectedValue(new Error('err|403'));
      const res = await app.request('/api/projects/proj1/members/u1', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/projects/:id/roles/:role_id', () => {
    it('updates role', async () => {
      mockRbacService.updateCustomRole.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/projects/proj1/roles/r1', { method: 'PUT', body: JSON.stringify({}) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.updateCustomRole.mockRejectedValue(new Error('err|400'));
      const res = await app.request('/api/projects/proj1/roles/r1', { method: 'PUT', body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/projects/:id/roles/:role_id', () => {
    it('deletes role', async () => {
      mockRbacService.deleteCustomRole.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/projects/proj1/roles/r1', { method: 'DELETE' });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.deleteCustomRole.mockRejectedValue(new Error('err|403'));
      const res = await app.request('/api/projects/proj1/roles/r1', { method: 'DELETE' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/auth/invitations', () => {
    it('gets invitations', async () => {
      mockRbacService.getInvitations.mockResolvedValue([{ id: 'i1' }]);
      const res = await app.request('/api/auth/invitations');
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.getInvitations.mockRejectedValue(new Error('err'));
      const res = await app.request('/api/auth/invitations');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/projects/:id/invitations', () => {
    it('creates invitation', async () => {
      mockRbacService.createInvitation.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/projects/proj1/invitations', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.createInvitation.mockRejectedValue(new Error('err|400'));
      const res = await app.request('/api/projects/proj1/invitations', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/invitations/accept', () => {
    it('accepts invitation', async () => {
      mockRbacService.acceptInvitation.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/invitations/accept', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.acceptInvitation.mockRejectedValue(new Error('err|404'));
      const res = await app.request('/api/auth/invitations/accept', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/auth/invitations/decline', () => {
    it('declines invitation', async () => {
      mockRbacService.declineInvitation.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/invitations/decline', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockRbacService.declineInvitation.mockRejectedValue(new Error('err|404'));
      const res = await app.request('/api/auth/invitations/decline', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(404);
    });
  });
});
