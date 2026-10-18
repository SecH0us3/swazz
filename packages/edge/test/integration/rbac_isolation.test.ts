// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Guardrails for cross-project isolation in RBAC: every route authorizes the caller on the
// path's :id project, so nothing reached through it may read or write another project's rows.

import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { ulid } from 'ulidx';
import { Env } from '../../src/env';
import { RbacRepository } from '../../src/repositories/rbac';
import { RbacService } from '../../src/services/rbac';
import { applyMigrations } from '../utils/migrations';

const env = { ...(rawEnv as unknown as Env), SESSION_CACHE: undefined } as Env;

async function seedProject(name: string): Promise<string> {
  const id = ulid();
  await env.DB.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').bind(id, name).run();
  return id;
}

async function seedUser(): Promise<string> {
  const id = ulid();
  await env.DB.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .bind(id, `u_${id.slice(-10).toLowerCase()}`, 'x').run();
  return id;
}

async function seedCustomRole(projectId: string, permissions: string[]): Promise<string> {
  const roleId = 'c_' + ulid();
  await new RbacRepository(env).createCustomRole(roleId, projectId, `role-${roleId.slice(-6)}`, permissions, []);
  return roleId;
}

async function rolePermissions(roleId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT permission_key FROM custom_role_permissions WHERE role_id = ? ORDER BY permission_key')
    .bind(roleId).all<{ permission_key: string }>();
  return (results || []).map(r => r.permission_key);
}

describe('RBAC cross-project isolation', () => {
  let repo: RbacRepository;
  let service: RbacService;

  beforeAll(async () => {
    await applyMigrations(env);
    repo = new RbacRepository(env);
    service = new RbacService(env, repo);
  });

  describe('custom roles are only reachable through their own project', () => {
    it('refuses to update a role of another project and leaves it untouched', async () => {
      const attackerProject = await seedProject('A');
      const victimProject = await seedProject('B');
      const attacker = await seedUser();
      const victimRole = await seedCustomRole(victimProject, ['get:/api/projects/:id']);

      await expect(service.updateCustomRole(attackerProject, attacker, victimRole, {
        name: 'x', included_roles: ['owner'], permissions: ['delete:/api/projects/:id'],
      })).rejects.toThrow('Role not found|404');

      expect(await rolePermissions(victimRole)).toEqual(['get:/api/projects/:id']);
      const { results } = await env.DB.prepare('SELECT child_role_id FROM custom_role_inheritance WHERE parent_role_id = ?')
        .bind(victimRole).all();
      expect(results).toHaveLength(0);
    });

    it('refuses to delete a role of another project and keeps its member assignments', async () => {
      const attackerProject = await seedProject('A');
      const victimProject = await seedProject('B');
      const attacker = await seedUser();
      const member = await seedUser();
      const victimRole = await seedCustomRole(victimProject, ['get:/api/projects/:id']);
      await repo.updateMemberRoles(victimProject, member, [victimRole]);

      await expect(service.deleteCustomRole(attackerProject, attacker, victimRole)).rejects.toThrow('Role not found|404');

      expect(await repo.checkCustomRolesExist(victimProject, [victimRole])).toEqual([victimRole]);
      expect(await repo.getMemberRoles(victimProject, member)).toEqual([victimRole]);
    });

    it('rejects the runner pseudo-role, which is not a custom role of any project', async () => {
      const project = await seedProject('A');
      const owner = await seedUser();

      await expect(service.updateCustomRole(project, owner, 'runner', { name: 'x', included_roles: ['owner'] }))
        .rejects.toThrow('Default roles cannot be edited|400');
      await expect(service.deleteCustomRole(project, owner, 'runner')).rejects.toThrow('Default roles cannot be deleted|400');

      const { results } = await env.DB.prepare("SELECT 1 FROM custom_role_inheritance WHERE parent_role_id = 'runner'").all();
      expect(results).toHaveLength(0);
    });

    it('still updates and deletes a role through its own project', async () => {
      const project = await seedProject('A');
      const owner = await seedUser();
      const member = await seedUser();
      const role = await seedCustomRole(project, ['get:/api/projects/:id']);
      await repo.updateMemberRoles(project, member, [role]);

      await service.updateCustomRole(project, owner, role, { name: 'renamed', permissions: ['get:/api/projects/:id/scans'] });
      expect(await rolePermissions(role)).toEqual(['get:/api/projects/:id/scans']);

      await service.deleteCustomRole(project, owner, role);
      expect(await repo.checkCustomRolesExist(project, [role])).toEqual([]);
      expect(await repo.getMemberRoles(project, member)).toEqual([]);
    });

    it('does not grant permissions from a role row that belongs to another project', async () => {
      const project = await seedProject('A');
      const otherProject = await seedProject('B');
      const user = await seedUser();
      const foreignRole = await seedCustomRole(otherProject, ['delete:/api/projects/:id']);
      // A stray assignment of another project's role must not widen access in this one.
      await env.DB.prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)')
        .bind(project, user, foreignRole).run();

      expect(await repo.checkPermission(user, project, 'delete:/api/projects/:id')).toBe(false);
    });

    it('does not follow inheritance rows whose parent is not a custom role of the project', async () => {
      const project = await seedProject('A');
      const user = await seedUser();
      await env.DB.prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)')
        .bind(project, user, 'runner').run();
      await env.DB.prepare("INSERT OR IGNORE INTO custom_role_inheritance (parent_role_id, child_role_id) VALUES ('runner', 'owner')").run();

      try {
        expect(await repo.checkPermission(user, project, 'delete:/api/projects/:id')).toBe(false);
      } finally {
        await env.DB.prepare("DELETE FROM custom_role_inheritance WHERE parent_role_id = 'runner'").run();
      }
    });
  });
});
