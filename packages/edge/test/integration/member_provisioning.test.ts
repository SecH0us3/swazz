import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { Env } from '../../src/env';
import { ProjectRepository } from '../../src/repositories/projects';
import { RbacRepository } from '../../src/repositories/rbac';
import { AuthRepository } from '../../src/repositories/auth';
import { ProjectService } from '../../src/services/projects';
import { AuthService } from '../../src/services/auth';
import { splitSql } from '../../src/splitSql';
import { ulid } from 'ulidx';

const env = rawEnv as unknown as Env;

describe('Member Provisioning Integration', () => {
  let projectService: ProjectService;
  let authService: AuthService;

  beforeAll(async () => {
    const migrationFiles = (import.meta as any).glob('../../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }) as Record<string, string>;

    const sortedPaths = Object.keys(migrationFiles).sort();

    for (const path of sortedPaths) {
      const sql = migrationFiles[path];
      const statements = splitSql(sql);

      for (const statement of statements) {
        try {
          await env.DB.prepare(statement).run();
        } catch (err: any) {
          const msg = String(err?.message ?? err);
          if (msg.includes('duplicate column name') || msg.includes('SQL code did not contain a statement')) continue;
          throw err;
        }
      }
    }

    projectService = new ProjectService(env, new ProjectRepository(env), new RbacRepository(env));
    authService = new AuthService(env, new AuthRepository(env));
  });

  it('provisions interactive user and verifies login', async () => {
    const projectId = ulid();
    const username = `u_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 100)}`;
    
    // Create the project member
    const res = await projectService.createProjectMemberAccount(projectId, {
      username,
      roles: ['editor'],
      is_interactive: true
    });

    expect(res.status).toBe('ok');
    expect(res.password).toBeDefined();
    expect(res.api_key).toBeUndefined();

    // Verify login works
    const loginRes = await authService.login({
      username,
      password: res.password
    }, '127.0.0.1', undefined, undefined, { req: { header: () => undefined, raw: {} } });

    expect(loginRes.status).toBe('ok');
    expect(loginRes.token).toBeDefined();
  });

  it('provisions non-interactive service account and verifies login is blocked', async () => {
    const projectId = ulid();
    const username = `s_${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 100)}`;

    const res = await projectService.createProjectMemberAccount(projectId, {
      username,
      roles: ['viewer'],
      is_interactive: false
    });

    expect(res.status).toBe('ok');
    expect(res.api_key).toBeDefined();
    expect(res.password).toBeUndefined();

    // Attempt interactive login, should fail
    await expect(authService.login({
      username,
      password: 'some-random-password'
    }, '127.0.0.1', undefined, undefined, { req: { header: () => undefined, raw: {} } }))
      .rejects.toThrow('Interactive login is disabled for service accounts');
  });
});
