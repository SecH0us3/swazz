// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Hono } from 'hono';
import { Env, AppEnv } from '../env';
import { getUserIdFromRequest, getClientIp } from '../utils/auth';
import { IScansRepository, ScansRepository } from '../repositories/scans';
import { IScansService, ScansService } from '../services/scans';
import { RbacRepository } from '../repositories/rbac';
import { requireFeature } from '../middleware/license';
import { FEATURE_AI_REMEDIATION_PRO } from '@swazz/shared';
import { errorStatus } from '../utils/http';
import {
  ValidationError,
  isValidId,
  LIMITS,
  readJsonBody,
  optString,
} from '../utils/validation';

export function registerScansRoutes(
  app: Hono<AppEnv>,
  scansServicesFactory: (env: Env) => IScansService = (env) => new ScansService(env, new ScansRepository(env), new RbacRepository(env))
) {
  app.post('/api/scans', async (c) => {
    const services = scansServicesFactory(c.env);
    const body = await readJsonBody(c, { maxBytes: LIMITS.LARGE_BODY_BYTES });
    optString(body.project_id, 'project_id', LIMITS.NAME);
    optString(body.target_url, 'target_url', LIMITS.URL);
    optString(body.profile, 'profile', LIMITS.SHORT_TEXT);
    optString(body.scan_mode, 'scan_mode', LIMITS.SHORT_TEXT);

    const userId = await getUserIdFromRequest(c);
    const authHeader = c.req.header('Authorization') ?? '';
    const clientIp = getClientIp(c);

    let waitUntil: any = undefined;
    try {
      if (c.executionCtx) {
        waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
      }
    } catch {}

    try {
      const result = await services.createScan(body, userId, authHeader, clientIp, waitUntil);
      return c.json(result, 201);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });
  
  app.get('/api/scans', async (c) => {
    const services = scansServicesFactory(c.env);
    const projectId = c.req.query('project_id');
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.getScans(projectId || '', userId);
      return c.json(result);
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });
  
  app.get('/api/scans/:id', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    if (!isValidId(scanId)) {
      return c.json({ error: 'Scan not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.getScan(scanId, userId);
      return c.json(result);
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });
  
  app.patch('/api/scans/:id', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    if (!isValidId(scanId)) {
      return c.json({ error: 'Scan not found' }, 404);
    }
    const body = await readJsonBody(c);
    optString(body.status, 'status', LIMITS.SHORT_TEXT);
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.updateScan(scanId, body, userId);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });
  
  app.post('/api/scans/:id/upload-url', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    if (!isValidId(scanId)) {
      return c.json({ error: 'Scan not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);

    try {
      const result = await services.generateUploadUrl(scanId, userId);
      return c.json(result);
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });
  
  app.put('/api/scans/:id/upload', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    if (!isValidId(scanId)) {
      return c.json({ error: 'Scan not found' }, 404);
    }
    const authHeader = c.req.header('X-Upload-Token');
    const bodyStream = c.req.raw.body;

    try {
      const result = await services.uploadReport(scanId, authHeader, bodyStream);
      return c.json(result);
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });
  
  app.get('/api/scans/:id/runner-logs', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    if (!isValidId(scanId)) {
      return c.json({ error: 'Scan not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const result = await services.getRunnerLogs(scanId, userId, isAuthEnabled);
      return c.json(result);
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.get('/api/scans/:id/findings', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    if (!isValidId(scanId)) {
      return c.json({ error: 'Scan not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const result = await services.getFindings(scanId, userId, isAuthEnabled);
      return c.json(result);
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.get('/api/findings/:id', async (c) => {
    const services = scansServicesFactory(c.env);
    const findingId = c.req.param('id');
    if (!isValidId(findingId)) {
      return c.json({ error: 'Finding not found' }, 404);
    }
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const result = await services.getFindingDetails(findingId, userId, isAuthEnabled);
      return c.json(result);
    } catch (err: any) {
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.patch('/api/findings/:id', async (c) => {
    const services = scansServicesFactory(c.env);
    const findingId = c.req.param('id');
    if (!isValidId(findingId)) {
      return c.json({ error: 'Finding not found' }, 404);
    }
    const body = await readJsonBody(c);
    optString(body.status, 'status', LIMITS.SHORT_TEXT);
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    let executionCtx: any = undefined;
    try {
      executionCtx = c.executionCtx;
    } catch {}

    try {
      const result = await services.updateFinding(findingId, body, userId, isAuthEnabled, executionCtx);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.patch('/api/scans/:id/findings/ai-triage', requireFeature(FEATURE_AI_REMEDIATION_PRO), async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    if (!isValidId(scanId)) {
      return c.json({ error: 'Scan not found' }, 404);
    }
    const body = await readJsonBody<{ updates?: any[] }>(c);
    const userId = await getUserIdFromRequest(c);
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const updates = (body.updates as any) || [];
      const result = await services.batchUpdateFindingsAI(scanId!, updates, userId, isAuthEnabled);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.patch('/api/scans/:id/waf-patch', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    if (!isValidId(scanId)) {
      return c.json({ error: 'Scan not found' }, 404);
    }
    const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

    try {
      const body = await readJsonBody(c);
      const userId = await getUserIdFromRequest(c);
      const result = await services.saveWAFPatchReport(scanId, body, userId, isAuthEnabled);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const parts = (err instanceof Error ? err.message : String(err)).split('|');
      const status = errorStatus(parts[1]);
      if (status >= 500) {
        console.error(err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: parts[0] }, status);
    }
  });

  app.post('/api/scans/:id/findings/:findingId/ai-analyze', async (c) => {
    const services = scansServicesFactory(c.env);
    const scanId = c.req.param('id');
    const findingId = c.req.param('findingId');
    if (!isValidId(scanId) || !isValidId(findingId)) {
      return c.json({ error: 'Finding not found' }, 404);
    }
    try {
      const body = await readJsonBody(c, { optional: true });
      optString(body.code_context, 'code_context', LIMITS.LONG_TEXT);
      if (typeof body.code_context === 'string' && body.code_context.length > 20_000) {
        body.code_context = body.code_context.slice(0, 20_000);
      }

      const userId = await getUserIdFromRequest(c);
      const clientIp = getClientIp(c);
      const isAuthEnabled = c.env.AUTH_ENABLED === 'true';

      let executionCtx: any = undefined;
      try {
        executionCtx = c.executionCtx;
      } catch {}

      const result = await services.analyzeFindingWithAI(
        scanId,
        findingId,
        body,
        userId,
        isAuthEnabled,
        executionCtx,
        clientIp
      );
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });
}
