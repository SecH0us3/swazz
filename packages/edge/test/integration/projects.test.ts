// @ts-nocheck
import { describe, it, expect, beforeAll } from 'vitest';
import { env as rawEnv } from 'cloudflare:test';
import { Env } from '../../src/env';
import { ProjectRepository } from '../../src/repositories/projects';
import { splitSql } from '../../src/splitSql';
import { ulid } from 'ulidx';

const env = rawEnv as unknown as Env;

beforeAll(async () => {
  // Use Vite's import.meta.glob to bundle SQL migrations as raw strings
  const migrationFiles = (import.meta as any).glob('../../migrations/*.sql', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  // Sort by filename to ensure migrations run in correct order
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
});

describe('ProjectRepository Integration', () => {
  let services: ProjectRepository;

  beforeAll(() => {
    services = new ProjectRepository(env);
  });

  it('creates a project successfully and links to user', async () => {
    const userId = ulid();
    const body = { name: 'Integration Test Project', description: 'Testing the DB directly' };
    
    // 1. Create project
    const { id: projectId } = await services.createProject(userId, body);
    expect(projectId).toBeDefined();

    // 2. Fetch projects for user
    const projects = await services.getProjects(userId);
    expect(projects.length).toBe(1);
    expect(projects[0].id).toBe(projectId);
    expect(projects[0].name).toBe('Integration Test Project');

    // 3. Verify user is member
    const isMember = await services.checkUserIsMember(projectId, userId);
    expect(isMember).toBe(true);
  });

  it('updates and retrieves project settings correctly', async () => {
    const userId = ulid();
    const { id: projectId } = await services.createProject(userId, { name: 'Old Name' });

    // Update settings
    const result = await services.updateProjectSettings(projectId, {
      name: 'New Name',
      description: 'New Desc',
      propose_fixes: true,
    });

    expect(result.updated).toBe(true);
    expect(result.afterDiff.name).toBe('New Name');
    expect(result.afterDiff.propose_fixes).toBe(1);

    // Verify in DB
    const projects = await services.getProjects(userId);
    const updatedProject = projects.find(p => p.id === projectId);
    expect(updatedProject?.name).toBe('New Name');
    expect(updatedProject?.description).toBe('New Desc');
  });

  it('deletes a project and its cascades', async () => {
    const userId = ulid();
    const { id: projectId } = await services.createProject(userId, { name: 'To Be Deleted' });

    // Verify exists
    let projects = await services.getProjects(userId);
    expect(projects.length).toBe(1);

    // Delete
    await services.deleteProject(projectId);

    // Verify deleted
    // It creates a 'Default Project' if user has no projects inside getProjects!
    // So the length might still be 1 (the auto-created default). Let's check the name.
    projects = await services.getProjects(userId);
    const originalDeleted = projects.find(p => p.id === projectId);
    expect(originalDeleted).toBeUndefined();
  });
});
