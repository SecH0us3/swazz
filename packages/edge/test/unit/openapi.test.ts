// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { registerAuthRoutes } from '../../src/routes/auth';
import { registerProjectsRoutes } from '../../src/routes/projects';
import { registerRbacRoutes } from '../../src/routes/rbac';
import { registerScansRoutes } from '../../src/routes/scans';
import { registerRunnersRoutes } from '../../src/routes/runners';
import { registerMiscRoutes } from '../../src/routes/misc';
import { registerMcpRoutes } from '../../src/routes/mcp';
import openapi from '../../openapi.json';

import indexSource from '../../src/index.ts?raw';
import authSource from '../../src/routes/auth.ts?raw';
import mcpSource from '../../src/routes/mcp.ts?raw';
import miscSource from '../../src/routes/misc.ts?raw';
import projectsSource from '../../src/routes/projects.ts?raw';
import rbacSource from '../../src/routes/rbac.ts?raw';
import runnersSource from '../../src/routes/runners.ts?raw';
import scansSource from '../../src/routes/scans.ts?raw';

const WS_UPGRADE_ROUTES = new Set([
  '/api/runners/connect',
  '/api/runs/:id/events',
]);

function normalizePath(honoPath: string): string {
  return honoPath.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');
}

function extractRoutesFromSource(source: string): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  const regex = /app\.(get|post|put|patch|delete|all)\s*\(\s*['"`](\/api\/[^'"`]+)['"`]/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2];
    if (!path.endsWith('*')) {
      routes.push({ method, path });
    }
  }
  return routes;
}

describe('OpenAPI 3.0.3 Specification Coverage', () => {
  it('should have valid basic OpenAPI 3.0.3 structure', () => {
    expect(openapi.openapi).toBe('3.0.3');
    expect(openapi.info).toBeDefined();
    expect(openapi.info.title).toBeDefined();
    expect(openapi.info.version).toBeDefined();
    expect(openapi.paths).toBeDefined();
    expect(openapi.components?.securitySchemes?.bearerAuth).toBeDefined();
    expect(openapi.components.securitySchemes.bearerAuth.type).toBe('http');
    expect(openapi.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('should cover all registered Hono route handlers (skipping WebSocket upgrades)', () => {
    const app = new Hono<any>();
    registerAuthRoutes(app);
    registerProjectsRoutes(app);
    registerRbacRoutes(app);
    registerScansRoutes(app);
    registerRunnersRoutes(app);
    registerMiscRoutes(app);
    registerMcpRoutes(app);

    const openapiPaths = openapi.paths as Record<string, any>;
    const missingRoutes: string[] = [];

    for (const route of app.routes) {
      if (!route.path.startsWith('/api/') || route.path.endsWith('*')) {
        continue;
      }
      if (WS_UPGRADE_ROUTES.has(route.path)) {
        continue;
      }

      const openapiPath = normalizePath(route.path);
      const pathItem = openapiPaths[openapiPath];

      if (!pathItem) {
        missingRoutes.push(`Missing path: ${route.method} ${route.path} -> ${openapiPath}`);
        continue;
      }

      if (route.method === 'ALL') {
        const methods = Object.keys(pathItem).filter((k) => k !== 'parameters' && k !== 'description');
        if (methods.length === 0) {
          missingRoutes.push(`Missing operations for ALL route: ${route.path} -> ${openapiPath}`);
        }
      } else {
        const methodKey = route.method.toLowerCase();
        if (!pathItem[methodKey]) {
          missingRoutes.push(`Missing method: ${route.method} on ${openapiPath}`);
        }
      }
    }

    expect(missingRoutes).toEqual([]);
  });

  it('should cover all routes defined in source code across src/index.ts and src/routes/*.ts', () => {
    const sources = [
      { name: 'index.ts', source: indexSource },
      { name: 'auth.ts', source: authSource },
      { name: 'mcp.ts', source: mcpSource },
      { name: 'misc.ts', source: miscSource },
      { name: 'projects.ts', source: projectsSource },
      { name: 'rbac.ts', source: rbacSource },
      { name: 'runners.ts', source: runnersSource },
      { name: 'scans.ts', source: scansSource },
    ];

    const openapiPaths = openapi.paths as Record<string, any>;
    const missingInSpec: string[] = [];

    for (const { name, source } of sources) {
      const codeRoutes = extractRoutesFromSource(source);
      for (const { method, path } of codeRoutes) {
        if (WS_UPGRADE_ROUTES.has(path)) {
          continue;
        }

        const openapiPath = normalizePath(path);
        const pathItem = openapiPaths[openapiPath];

        if (!pathItem) {
          missingInSpec.push(`[${name}] Missing path: ${method} ${path} -> ${openapiPath}`);
          continue;
        }

        if (method === 'ALL') {
          const ops = Object.keys(pathItem).filter((k) => k !== 'parameters' && k !== 'description');
          if (ops.length === 0) {
            missingInSpec.push(`[${name}] Missing operations for ALL route: ${path} -> ${openapiPath}`);
          }
        } else {
          const methodKey = method.toLowerCase();
          if (!pathItem[methodKey]) {
            missingInSpec.push(`[${name}] Missing method: ${method} on ${openapiPath}`);
          }
        }
      }
    }

    expect(missingInSpec).toEqual([]);
  });

  it('fails if a route exists in code but is missing from openapi.json', () => {
    const testApp = new Hono<any>();
    testApp.get('/api/some-future-endpoint', (c) => c.text('hello'));

    const openapiPaths = openapi.paths as Record<string, any>;
    const missing: string[] = [];

    for (const route of testApp.routes) {
      if (!route.path.startsWith('/api/') || route.path.endsWith('*') || WS_UPGRADE_ROUTES.has(route.path)) {
        continue;
      }
      const openapiPath = normalizePath(route.path);
      const pathItem = openapiPaths[openapiPath];
      if (!pathItem || !pathItem[route.method.toLowerCase()]) {
        missing.push(`${route.method} ${openapiPath}`);
      }
    }

    expect(missing).toEqual(['GET /api/some-future-endpoint']);
  });
});
