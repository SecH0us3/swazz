// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Hono } from 'hono';
import { Env, AppEnv } from '../env';
import { requirePermission } from '../middleware/rbac';
import { requireFeature } from '../middleware/license';
import { auditLog } from '../middleware/auditLog';
import { getUserIdFromRequest } from '../utils/auth';
import { IRbacRepository, RbacRepository } from '../repositories/rbac';
import { IRbacService, RbacService } from '../services/rbac';
import { FEATURE_ENTERPRISE } from '@swazz/shared';
import { errorStatus } from '../utils/http';
import { ValidationError, isValidId, LIMITS, readJsonBody, optString, optStringArray } from '../utils/validation';

export function registerRbacRoutes(
  app: Hono<AppEnv>,
  rbacServicesFactory: (env: Env) => IRbacService = (env) => new RbacService(env, new RbacRepository(env))
) {
  
  app.get('/api/projects/:id/permissions', requirePermission('get:/api/projects/:id'), async (c) => {
    const projectId = (c.req.param('id') as string);
    if (!isValidId(projectId)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const services = rbacServicesFactory(c.env);
    return c.json(services.getPermissions());
  });

  app.get('/api/projects/:id/roles', requirePermission('get:/api/projects/:id/roles'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    if (!isValidId(projectId)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    try {
      const result = await services.getRoles(projectId);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      console.error('getRoles error:', e);
      return c.json({ error: 'Internal Server Error' }, 500);
    }
  });

  app.post('/api/projects/:id/roles', requirePermission('post:/api/projects/:id/roles'), requireFeature(FEATURE_ENTERPRISE), auditLog('post:/api/projects/:id/roles', 'Created custom role'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    if (!isValidId(projectId)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);
    const body = await readJsonBody(c);
    optString(body.name, 'name', LIMITS.NAME);
    optString(body.description, 'description', LIMITS.DESCRIPTION);
    optStringArray(body.permissions, 'permissions', 100, LIMITS.SHORT_TEXT);
    optStringArray(body.included_roles, 'included_roles', 20, LIMITS.SHORT_TEXT);
    optStringArray(body.inherits, 'inherits', 20, LIMITS.SHORT_TEXT);

    try {
      const result = await services.createCustomRole(projectId, userId, body);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      if (e instanceof TypeError) return c.json({ error: e.message }, 400);
      const parts = (e instanceof Error ? e.message : String(e)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error('createCustomRole error:', e);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.get('/api/projects/:id/members', requirePermission('get:/api/projects/:id/members'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    if (!isValidId(projectId)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    try {
      const result = await services.getMembers(projectId);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      console.error('getMembers error:', e);
      return c.json({ error: 'Internal Server Error' }, 500);
    }
  });

  app.put('/api/projects/:id/members/:user_id', requirePermission('put:/api/projects/:id/members/:user_id'), requireFeature(FEATURE_ENTERPRISE), auditLog('put:/api/projects/:id/members/:user_id', 'Updated member role'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    if (!isValidId(projectId)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const memberId = (c.req.param('user_id') as string);
    if (!isValidId(memberId)) {
      return c.json({ error: 'Member not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);
    const body = await readJsonBody(c);
    optStringArray(body.roles, 'roles', 20, LIMITS.SHORT_TEXT);

    try {
      const result = await services.updateMemberRoles(projectId, userId, memberId, body);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      if (e instanceof TypeError) return c.json({ error: e.message }, 400);
      const parts = (e instanceof Error ? e.message : String(e)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error('updateMemberRoles error:', e);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.delete('/api/projects/:id/members/:user_id', requirePermission('delete:/api/projects/:id/members/:user_id'), requireFeature(FEATURE_ENTERPRISE), auditLog('delete:/api/projects/:id/members/:user_id', 'Removed a member'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    if (!isValidId(projectId)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const memberId = (c.req.param('user_id') as string);
    if (!isValidId(memberId)) {
      return c.json({ error: 'Member not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.removeMember(projectId, userId, memberId);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      const parts = (e instanceof Error ? e.message : String(e)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error('removeMember error:', e);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.put('/api/projects/:id/roles/:role_id', requirePermission('put:/api/projects/:id/roles/:role_id'), requireFeature(FEATURE_ENTERPRISE), auditLog('put:/api/projects/:id/roles/:role_id', 'Updated custom role'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    if (!isValidId(projectId)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const roleId = c.req.param('role_id') as string;
    if (!isValidId(roleId)) {
      return c.json({ error: 'Role not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);
    const body = await readJsonBody(c);
    optString(body.name, 'name', LIMITS.NAME);
    optString(body.description, 'description', LIMITS.DESCRIPTION);
    optStringArray(body.permissions, 'permissions', 100, LIMITS.SHORT_TEXT);
    optStringArray(body.included_roles, 'included_roles', 20, LIMITS.SHORT_TEXT);
    optStringArray(body.inherits, 'inherits', 20, LIMITS.SHORT_TEXT);

    try {
      const result = await services.updateCustomRole(projectId, userId, roleId, body);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      if (e instanceof TypeError) return c.json({ error: e.message }, 400);
      const parts = (e instanceof Error ? e.message : String(e)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error('updateCustomRole error:', e);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.delete('/api/projects/:id/roles/:role_id', requirePermission('delete:/api/projects/:id/roles/:role_id'), requireFeature(FEATURE_ENTERPRISE), auditLog('delete:/api/projects/:id/roles/:role_id', 'Deleted custom role'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    if (!isValidId(projectId)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const roleId = c.req.param('role_id') as string;
    if (!isValidId(roleId)) {
      return c.json({ error: 'Role not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.deleteCustomRole(projectId, userId, roleId);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      const parts = (e instanceof Error ? e.message : String(e)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error('deleteCustomRole error:', e);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.get('/api/auth/invitations', async (c) => {
    const services = rbacServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.getInvitations(userId);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      const parts = (e instanceof Error ? e.message : String(e)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error('getInvitations error:', e);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.post('/api/projects/:id/invitations', requirePermission('post:/api/projects/:id/invitations'), requireFeature(FEATURE_ENTERPRISE), auditLog('post:/api/projects/:id/invitations', 'Invited a member'), async (c) => {
    const services = rbacServicesFactory(c.env);
    const projectId = (c.req.param('id') as string);
    if (!isValidId(projectId)) {
      return c.json({ error: 'Project not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);
    const body = await readJsonBody(c);
    optString(body.email, 'email', LIMITS.EMAIL);
    optString(body.username, 'username', LIMITS.USERNAME);
    optString(body.role, 'role', LIMITS.SHORT_TEXT);
    optStringArray(body.roles, 'roles', 20, LIMITS.SHORT_TEXT);
    optString(body['cf-turnstile-response'], 'cf-turnstile-response', LIMITS.SHORT_TEXT);

    const turnstileToken = body['cf-turnstile-response'] as string | undefined;
    const remoteIp = c.req.header('CF-Connecting-IP') ?? undefined;

    try {
      const result = await services.createInvitation(projectId, userId, body, turnstileToken, remoteIp);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      if (e instanceof TypeError) return c.json({ error: e.message }, 400);
      const parts = (e instanceof Error ? e.message : String(e)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error('createInvitation error:', e);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.post('/api/auth/invitations/accept', async (c) => {
    const services = rbacServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c);
    const body = await readJsonBody(c);
    optString(body.token, 'token', LIMITS.SHORT_TEXT);
    optString(body.invitationId, 'invitationId', LIMITS.SHORT_TEXT);

    try {
      const result = await services.acceptInvitation(userId, body);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      if (e instanceof TypeError) return c.json({ error: e.message }, 400);
      const parts = (e instanceof Error ? e.message : String(e)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error('acceptInvitation error:', e);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.post('/api/auth/invitations/decline', async (c) => {
    const services = rbacServicesFactory(c.env);
    const userId = await getUserIdFromRequest(c);
    const body = await readJsonBody(c);
    optString(body.token, 'token', LIMITS.SHORT_TEXT);
    optString(body.invitationId, 'invitationId', LIMITS.SHORT_TEXT);

    try {
      const result = await services.declineInvitation(userId, body);
      return c.json(result);
    } catch (e: any) {
      if (e instanceof ValidationError) return c.json({ error: e.message }, e.status);
      if (e instanceof TypeError) return c.json({ error: e.message }, 400);
      const parts = (e instanceof Error ? e.message : String(e)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error('declineInvitation error:', e);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });
}

