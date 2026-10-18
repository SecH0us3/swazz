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
import { ProjectService } from '../../src/services/projects';
import { ProjectRepository } from '../../src/repositories/projects';
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
  let projectService: ProjectService;

  beforeAll(async () => {
    await applyMigrations(env);
    repo = new RbacRepository(env);
    service = new RbacService(env, repo);
    projectService = new ProjectService(env, new ProjectRepository(env), repo);
  });

  /** Adds a member the way real paths do: both the legacy column and the role rows. */
  async function addMember(projectId: string, userId: string, roles: string[]): Promise<void> {
    await env.DB.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
      .bind(projectId, userId, roles[0]).run();
    for (const r of roles) {
      await env.DB.prepare('INSERT INTO project_member_roles (project_id, user_id, role_id) VALUES (?, ?, ?)')
        .bind(projectId, userId, r).run();
    }
  }

  describe('no role grant exceeds what the caller holds', () => {
    it('an editor cannot provision an owner account', async () => {
      const project = await seedProject('B');
      const editor = await seedUser();
      await addMember(project, editor, ['editor']);

      await expect(projectService.createProjectMemberAccount(project, {
        username: `svc_${ulid().slice(-8).toLowerCase()}`, roles: ['owner'], is_interactive: false,
      }, editor)).rejects.toThrow('|403');
    });

    it('an editor can still provision an editor account', async () => {
      const project = await seedProject('B');
      const editor = await seedUser();
      await addMember(project, editor, ['editor']);

      const res = await projectService.createProjectMemberAccount(project, {
        username: `svc_${ulid().slice(-8).toLowerCase()}`, roles: ['editor'], is_interactive: false,
      }, editor);
      expect(res.status).toBe('ok');
    });

    it('a member with only the invitation permission cannot invite an owner', async () => {
      const project = await seedProject('B');
      const inviter = await seedUser();
      const role = await seedCustomRole(project, ['post:/api/projects/:id/invitations']);
      await addMember(project, inviter, [role]);

      await expect(service.createInvitation(project, inviter, { username: 'alt', roles: ['owner'] }))
        .rejects.toThrow('|403');
    });

    it('an editor cannot promote another member to owner', async () => {
      const project = await seedProject('B');
      const editor = await seedUser();
      const other = await seedUser();
      await addMember(project, editor, ['editor']);
      await addMember(project, other, ['viewer']);

      await expect(service.updateMemberRoles(project, editor, other, { roles: ['owner'] })).rejects.toThrow('|403');
      expect(await repo.getMemberRoles(project, other)).toEqual(['viewer']);
    });

    it('an editor cannot define a custom role that includes owner or extra permissions', async () => {
      const project = await seedProject('B');
      const editor = await seedUser();
      await addMember(project, editor, ['editor']);

      await expect(service.createCustomRole(project, editor, { name: 'esc', included_roles: ['owner'] })).rejects.toThrow('|403');
      await expect(service.createCustomRole(project, editor, { name: 'esc2', permissions: ['delete:/api/projects/:id'] }))
        .rejects.toThrow('|403');
    });

    it('an owner can grant owner', async () => {
      const project = await seedProject('B');
      const owner = await seedUser();
      const other = await seedUser();
      await addMember(project, owner, ['owner']);
      await addMember(project, other, ['viewer']);

      await service.updateMemberRoles(project, owner, other, { roles: ['owner'] });
      expect(await repo.getMemberRoles(project, other)).toEqual(['owner']);
    });

    it('rejects the runner pseudo-role as a member role', async () => {
      const project = await seedProject('B');
      const owner = await seedUser();
      const other = await seedUser();
      await addMember(project, owner, ['owner']);
      await addMember(project, other, ['viewer']);

      await expect(service.updateMemberRoles(project, owner, other, { roles: ['runner'] })).rejects.toThrow('Invalid role(s): runner|400');
    });
  });

  describe('invitations addressed to an email', () => {
    async function seedUserWithEmail(email: string, verified: boolean): Promise<string> {
      const id = await seedUser();
      await env.DB.prepare('UPDATE users SET email = ?, email_verified = ? WHERE id = ?').bind(email, verified ? 1 : 0, id).run();
      return id;
    }

    async function invite(email: string): Promise<{ project: string; token: string }> {
      const project = await seedProject('P');
      const owner = await seedUser();
      await addMember(project, owner, ['owner']);
      const { token } = await service.createInvitation(project, owner, { email, roles: ['editor'] });
      return { project, token };
    }

    it('are not listed or accepted by an account whose matching email is unverified', async () => {
      const email = `alice_${ulid().toLowerCase()}@corp.example`;
      const { project, token } = await invite(email);
      const squatter = await seedUserWithEmail(email, false);

      expect((await service.getInvitations(squatter)).invitations).toHaveLength(0);
      await expect(service.acceptInvitation(squatter, { token })).rejects.toThrow('|403');
      await expect(service.declineInvitation(squatter, { token })).rejects.toThrow('|400');
      expect(await repo.getMemberRoles(project, squatter)).toEqual([]);
    });

    it('are listed and accepted by the verified owner of the address, case-insensitively', async () => {
      const email = `bob_${ulid().toLowerCase()}@corp.example`;
      const { project, token } = await invite(email);
      const invitee = await seedUserWithEmail(email.toUpperCase(), true);

      const { invitations } = await service.getInvitations(invitee);
      expect(invitations.map((i: any) => i.token)).toEqual([token]);
      await service.acceptInvitation(invitee, { token });
      expect(await repo.getMemberRoles(project, invitee)).toEqual(['editor']);
    });

    it('addressed to a username still work without an email', async () => {
      const project = await seedProject('P');
      const owner = await seedUser();
      const invitee = await seedUser();
      await addMember(project, owner, ['owner']);
      const user = await repo.getUserDetails(invitee);
      const { token } = await service.createInvitation(project, owner, { username: user!.username, roles: ['viewer'] });

      await service.acceptInvitation(invitee, { token });
      expect(await repo.getMemberRoles(project, invitee)).toEqual(['viewer']);
    });
  });

  describe('member role edits', () => {
    it('cannot attach a user who is not a member of the project', async () => {
      const project = await seedProject('B');
      const owner = await seedUser();
      const outsider = await seedUser();
      await addMember(project, owner, ['owner']);

      await expect(service.updateMemberRoles(project, owner, outsider, { roles: ['viewer'] })).rejects.toThrow('Member not found|404');
      expect(await repo.getMemberRoles(project, outsider)).toEqual([]);
    });

    it('demoting a member removes the privileges of the old role', async () => {
      const project = await seedProject('B');
      const owner = await seedUser();
      const editor = await seedUser();
      await addMember(project, owner, ['owner']);
      await addMember(project, editor, ['editor']);
      expect(await repo.checkPermission(editor, project, 'post:/api/projects/:id/invitations')).toBe(true);

      await service.updateMemberRoles(project, owner, editor, { roles: ['viewer'] });

      expect(await repo.checkPermission(editor, project, 'post:/api/projects/:id/invitations')).toBe(false);
      expect(await repo.checkPermission(editor, project, 'get:/api/projects/:id')).toBe(true);
      const legacy = await env.DB.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
        .bind(project, editor).first<{ role: string }>();
      expect(legacy?.role).toBe('viewer');
    });

    it('a demoted co-owner no longer counts as an owner', async () => {
      const project = await seedProject('B');
      const ownerA = await seedUser();
      const ownerB = await seedUser();
      await addMember(project, ownerA, ['owner']);
      await addMember(project, ownerB, ['owner']);

      await service.updateMemberRoles(project, ownerA, ownerB, { roles: ['viewer'] });

      expect(await repo.getProjectOwnersCount(project)).toBe(1);
      expect(await repo.checkPermission(ownerB, project, 'delete:/api/projects/:id')).toBe(false);
    });
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
      await addMember(project, owner, ['owner']);
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
