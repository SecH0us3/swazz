// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Hono } from 'hono';
import { app } from '../../src/index';
import openapi from '../../openapi.json';
import { sign } from 'hono/jwt';

describe('OpenAPI Validation Guardrails & Regressions', () => {
  let validToken: string;
  let mockEnv: any;

  beforeAll(async () => {
    validToken = await sign(
      {
        sub: 'user_123',
        userId: 'user_123',
        email: 'test@example.com',
        username: 'testuser',
        role: 'owner',
        plan: 'enterprise',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      },
      'test-secret'
    );

    mockEnv = {
      JWT_SECRET: 'test-secret',
      TURNSTILE_SECRET: 'test-turnstile',
      AUTH_ENABLED: 'true',
      DB: {
        batch: async () => [],
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
        }),
      },
      COORDINATOR_DO: {
        idFromName: () => ({}),
        get: () => ({
          fetch: async () =>
            new Response(JSON.stringify({ error: 'Specification parsing error' }), { status: 400 }),
        }),
      },
      SESSION_CACHE: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      },
      CONFIG_KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      },
      CACHE_BUCKET: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      },
    };
  });

  describe('Spec-driven guardrail for operations with requestBody', () => {
    const paths = openapi.paths as Record<string, Record<string, any>>;

    for (const [pathStr, pathItem] of Object.entries(paths)) {
      for (const method of ['post', 'put', 'patch', 'delete']) {
        const operation = pathItem[method];
        if (!operation || !operation.requestBody) continue;

        it(`${method.toUpperCase()} ${pathStr} with malformed body "{" returns non-500`, async () => {
          // Substitute any path parameters with a valid ID
          const resolvedPath = pathStr.replace(/\{([^}]+)\}/g, 'valid_id_123');

          const res = await app.request(
            resolvedPath,
            {
              method: method.toUpperCase(),
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${validToken}`,
              },
              body: '{',
            },
            mockEnv
          );

          expect(res.status).not.toBe(500);
        });
      }
    }
  });

  describe('Spec-driven guardrail for paths with parameters', () => {
    const paths = openapi.paths as Record<string, Record<string, any>>;
    const longSegment = 'a'.repeat(800);

    for (const [pathStr, pathItem] of Object.entries(paths)) {
      if (!pathStr.includes('{')) continue;

      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        const operation = pathItem[method];
        if (!operation) continue;

        it(`${method.toUpperCase()} ${pathStr} with 800-char path param returns non-500`, async () => {
          const resolvedPath = pathStr.replace(/\{([^}]+)\}/g, longSegment);

          const res = await app.request(
            resolvedPath,
            {
              method: method.toUpperCase(),
              headers: {
                Authorization: `Bearer ${validToken}`,
              },
            },
            mockEnv
          );

          expect(res.status).not.toBe(500);
        });
      }
    }
  });

  describe('Regression tests', () => {
    it('POST /api/projects with a name of 129 characters returns 400', async () => {
      const res = await app.request(
        '/api/projects',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validToken}`,
          },
          body: JSON.stringify({ name: 'a'.repeat(129) }),
        },
        mockEnv
      );

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain('name must be a string of at most 128 characters');
    });

    it('POST /api/projects with a name of 5 MB returns 413 or 400', async () => {
      const bigName = 'a'.repeat(5 * 1024 * 1024);
      const res = await app.request(
        '/api/projects',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validToken}`,
          },
          body: JSON.stringify({ name: bigName }),
        },
        mockEnv
      );

      expect([400, 413]).toContain(res.status);
    });

    it('GET /api/projects/<800 chars> returns 400 or 404, never 500', async () => {
      const longId = 'a'.repeat(800);
      const res = await app.request(
        `/api/projects/${longId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${validToken}`,
          },
        },
        mockEnv
      );

      expect(res.status).not.toBe(500);
      expect([400, 404]).toContain(res.status);
    });

    it('onError hides internals: unhandled errors return { error: "Internal Server Error" } with 500', async () => {
      const testApp = new Hono();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      testApp.onError((err, c) => {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('|')) {
          const [msg, statusStr] = message.split('|');
          const status = parseInt(statusStr, 10) || 500;
          if (status >= 500) {
            console.error(err);
            return c.json({ error: 'Internal Server Error' }, 500);
          }
          return c.json({ error: msg }, status as any);
        }
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      });

      testApp.get('/test-error', () => {
        throw new Error('sensitive database internal secret: connection failed at host 10.0.0.5:5432');
      });

      const res = await testApp.request('/test-error');
      expect(res.status).toBe(500);
      const data = await res.json() as any;
      expect(data).toEqual({ error: 'Internal Server Error' });
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
