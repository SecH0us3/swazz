import { env as rawEnv } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Env } from '../../src/env';
import { AuthRepository } from '../../src/repositories/auth';
import { AuthService } from '../../src/services/auth';
import { splitSql } from '../../src/splitSql';

const env = rawEnv as unknown as Env;

describe('AuthService Integration', () => {
  let authServices: AuthService;

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

    authServices = new AuthService(env, new AuthRepository(env));
  });

  describe('User Registration & Login', () => {
    it('should register a new user with a valid username and password', async () => {
      const username = `testuser_${Date.now()}`;
      const res = await authServices.register({
        username: username,
        password: 'securepassword123'
      }, undefined, undefined, { req: { header: () => undefined, raw: {} } });

      expect(res.status).toBe('ok');
      expect(res.id).toBeDefined();
      expect(res.token).toBeDefined();
      expect(res.api_key).toBeDefined();
    });

    it('should fail to register a user that already exists', async () => {
      const username = `dupuser_${Date.now()}`;
      
      // First registration
      await authServices.register({
        username: username,
        password: 'securepassword123'
      }, undefined, undefined, { req: { header: () => undefined, raw: {} } });

      // Second registration should fail
      await expect(authServices.register({
        username: username,
        password: 'anotherpassword123'
      }, undefined, undefined, { req: { header: () => undefined, raw: {} } })).rejects.toThrow('Username already exists');
    });

    it('should login an existing user', async () => {
      const username = `loginuser_${Date.now()}`;
      const password = 'securepassword123';

      // Register first
      await authServices.register({
        username: username,
        password: password
      }, undefined, undefined, { req: { header: () => undefined, raw: {} } });

      // Attempt login (Step 1 and 2 conceptually)
      // Since testing JWT_SECRET is 'test-secret', the login logic bypasses step 1 PoW challenge
      const res = await authServices.login({
        username: username,
        password: password
      }, '127.0.0.1', undefined, undefined, { req: { header: () => undefined, raw: {} } });

      expect(res.status).toBe('ok');
      expect(res.token).toBeDefined();
    });

    it('should lock out a user after too many failed attempts', async () => {
      const username = `lockout_${Date.now()}`;
      const password = 'securepassword123';

      await authServices.register({
        username: username,
        password: password
      }, undefined, undefined, { req: { header: () => undefined, raw: {} } });

      // Simulate 5 failed logins
      for (let i = 0; i < 5; i++) {
        await expect(authServices.login({
          username: username,
          password: 'wrongpassword'
        }, '127.0.0.1', undefined, undefined, { req: { header: () => undefined, raw: {} } })).rejects.toThrow('Invalid credentials');
      }

      // 6th attempt should return lockout message
      await expect(authServices.login({
        username: username,
        password: password
      }, '127.0.0.1', undefined, undefined, { req: { header: () => undefined, raw: {} } })).rejects.toThrow(/Account temporarily locked/);
    });
  });

  describe('Guest Users', () => {
    it('should create a guest user through step 1 and 2', async () => {
      // Step 1
      const step1 = await authServices.registerGuestStep1('127.0.0.1', undefined, undefined);
      expect(step1.status).toBe('ok');
      expect(step1.challenge).toBeDefined();
      expect(step1.token).toBeDefined();

      // Solve Proof of Work challenge
      let nonce = 0;
      const targetPrefix = '0'.repeat(step1.difficulty);
      const encoder = new TextEncoder();
      
      while (true) {
        const text = step1.challenge + nonce;
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(text));
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        if (hashHex.startsWith(targetPrefix)) {
          break;
        }
        nonce++;
      }

      // Step 2
      const step2 = await authServices.registerGuest({
        token: step1.token,
        nonce: nonce
      }, undefined, undefined, { req: { header: () => undefined, raw: {} } });

      expect(step2.status).toBe('ok');
      expect(step2.username).toMatch(/^g_/);
      expect(step2.token).toBeDefined();
    });
  });

  describe('User Deletion', () => {
    it('should schedule user deletion and cancel it', async () => {
      const username = `deluser_${Date.now()}`;
      const reg = await authServices.register({
        username: username,
        password: 'securepassword123'
      }, undefined, undefined, { req: { header: () => undefined, raw: {} } });

      // Delete user
      const delRes = await authServices.deleteUser(reg.id, { req: { header: () => undefined, raw: {} } });
      expect(delRes.status).toBe('deletion_scheduled');

      // Check me - should show requested at
      const me1 = await authServices.getMe(reg.id);
      expect(me1.delete_requested_at).toBeDefined();

      // Cancel deletion
      const cancelRes = await authServices.cancelDeleteUser(reg.id);
      expect(cancelRes.status).toBe('deletion_cancelled');

      // Check me - should be null again
      const me2 = await authServices.getMe(reg.id);
      expect(me2.delete_requested_at).toBeNull();
    });
  });
});
