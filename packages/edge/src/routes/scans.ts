// @ts-nocheck
import { Hono } from 'hono';
import { Env } from '../env';
import { getDB } from '../utils/db';
import { getUserIdFromRequest } from '../utils/auth';
import { ulid } from 'ulidx';
import { sign, verify } from 'hono/jwt';
import { checkPermission } from '../utils/rbac';

export function registerScansRoutes(app: Hono<{ Bindings: Env }>) {
  app.post('/api/scans', async (c) => {
    const body = await c.req.json();
    if (!body.project_id || !body.target_url || !body.profile) {
      return c.json({ error: 'Missing required fields: project_id, target_url, profile' }, 400);
    }
  
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      const hasAccess = await checkPermission(c.env, userId, body.project_id, 'post:/api/projects/:id/scans');
      if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
    }
  
    const id = ulid();
    const status = 'queued';
  
    await getDB(c.env).prepare(
      `INSERT INTO scans (id, project_id, target_url, profile, status)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(id, body.project_id, body.target_url, body.profile, status)
      .run();
  
    let userPublicKey = "";
    if (userId) {
      try {
        const user = await getDB(c.env).prepare('SELECT public_key FROM users WHERE id = ?')
          .bind(userId)
          .first<{ public_key: string | null }>();
        if (user && user.public_key) {
          userPublicKey = user.public_key;
        }
      } catch (dbErr) {
        console.error("Failed to query user public key in /api/scans:", dbErr);
      }
    }

    // Send to SCAN_QUEUE instead of immediately fetching /dispatch on COORDINATOR_DO
    await c.env.SCAN_QUEUE.send({
      runId: id,
      config: body.config || {},
      userPublicKey,
      targetUrl: body.target_url,
      profile: body.profile,
      projectId: body.project_id,
      userId
    });
  
    return c.json({ id, status: 'queued' }, 201);
  });
  
  app.get('/api/scans', async (c) => {
    const projectId = c.req.query('project_id');
    if (!projectId) {
      return c.json({ error: 'Missing query parameter: project_id' }, 400);
    }
  
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      const hasAccess = await checkPermission(c.env, userId, projectId, 'get:/api/projects/:id/scans');
      if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
    }
  
    const { results } = await getDB(c.env).prepare(
      'SELECT * FROM scans WHERE project_id = ? ORDER BY created_at DESC'
    )
      .bind(projectId)
      .all();
  
    return c.json({ scans: results });
  });
  
  app.get('/api/scans/:id', async (c) => {
    const scanId = c.req.param('id');
    const scan = await getDB(c.env).prepare('SELECT * FROM scans WHERE id = ?')
      .bind(scanId)
      .first<{ id: string; project_id: string }>();
  
    if (!scan) {
      return c.json({ error: 'Scan not found' }, 404);
    }
  
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      const hasAccess = await checkPermission(c.env, userId, scan.project_id, 'get:/api/projects/:id/scans');
      if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
    }
  
    return c.json({ scan });
  });
  
  app.patch('/api/scans/:id', async (c) => {
    const scanId = c.req.param('id');
    const body = await c.req.json();
  
    // Verify scan exists
    const scan = await getDB(c.env).prepare('SELECT id, project_id FROM scans WHERE id = ?')
      .bind(scanId)
      .first<{ id: string; project_id: string }>();
    if (!scan) {
      return c.json({ error: 'Scan not found' }, 404);
    }
  
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      const hasAccess = await checkPermission(c.env, userId, scan.project_id, 'post:/api/projects/:id/scans');
      if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
    }
  
    // Build dynamic SET clause for allowed fields
    const allowedFields = ['status', 'summary_stats', 'report_url', 'completed_at'] as const;
    const setClauses: string[] = [];
    const values: (string | null)[] = [];
  
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(body[field]);
      }
    }
  
    if (setClauses.length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400);
    }
  
    values.push(scanId);
    await getDB(c.env).prepare(`UPDATE scans SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  
    const updated = await getDB(c.env).prepare('SELECT * FROM scans WHERE id = ?')
      .bind(scanId)
      .first();
  
    return c.json({ scan: updated });
  });
  
  // ---------------------------------------------------------------------------
  // R2 Presigned Upload URL flow
  // ---------------------------------------------------------------------------
  
  /**
   * Step 1: Runner requests an upload token for a specific scan.
   * Returns a short-lived JWT (15 min) locked to the scan ID and the target R2 key.
   */
  app.post('/api/scans/:id/upload-url', async (c) => {
    const scanId = c.req.param('id');
  
    // Verify scan exists
    const scan = await getDB(c.env).prepare('SELECT id, project_id, status FROM scans WHERE id = ?')
      .bind(scanId)
      .first<{ id: string; project_id: string; status: string }>();
    if (!scan) {
      return c.json({ error: 'Scan not found' }, 404);
    }
  
    const userId = await getUserIdFromRequest(c);
    if (userId) {
      const hasAccess = await checkPermission(c.env, userId, scan.project_id, 'post:/api/projects/:id/scans');
      if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
    }
  
    const r2Key = `reports/${scanId}.enc`;
    const secret = c.env.JWT_SECRET;
    if (!secret) return c.json({ error: 'Internal server error: auth not configured' }, 500);
  
    const uploadToken = await sign(
      {
        purpose: 'upload',
        scan_id: scanId,
        r2_key: r2Key,
        exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes
      },
      secret
    );
  
    return c.json({
      upload_token: uploadToken,
      r2_key: r2Key,
      method: 'PUT',
      url: `/api/scans/${scanId}/upload`,
      expires_in: 900, // seconds
    });
  });
  
  /**
   * Step 2: Runner uploads the archive via PUT with the upload token.
   * Writes the body to R2 at `reports/<scan_id>.enc`.
   */
  app.put('/api/scans/:id/upload', async (c) => {
    const scanId = c.req.param('id');
    const authHeader = c.req.header('X-Upload-Token');
    if (!authHeader) {
      return c.json({ error: 'Missing X-Upload-Token header' }, 401);
    }
  
    const secret = c.env.JWT_SECRET;
    if (!secret) return c.json({ error: 'Internal server error: auth not configured' }, 500);
  
    try {
      const decoded = await verify(authHeader, secret, "HS256") as {
        purpose: string;
        scan_id: string;
        r2_key: string;
        exp: number;
      };
  
      if (decoded.purpose !== 'upload' || decoded.scan_id !== scanId) {
        return c.json({ error: 'Token does not match this scan' }, 403);
      }
  
      const bodyStream = c.req.raw.body;
      if (!bodyStream) {
        return c.json({ error: 'Empty body' }, 400);
      }
  
      await c.env.STORAGE.put(decoded.r2_key, bodyStream, {
        customMetadata: {
          scan_id: scanId,
          uploaded_at: new Date().toISOString(),
        },
      });
  
      // Update scan record with report_url
      await getDB(c.env).prepare('UPDATE scans SET report_url = ?, is_encrypted = 1 WHERE id = ?')
        .bind(decoded.r2_key, scanId)
        .run();
  
      return c.json({ status: 'uploaded', r2_key: decoded.r2_key });
    } catch (err: any) {
      if (err?.name === 'JwtTokenExpired' || err?.message?.includes('expired')) {
        return c.json({ error: 'Upload token expired' }, 401);
      }
      return c.json({ error: 'Invalid upload token' }, 403);
    }
  });
  
  // ---------------------------------------------------------------------------
  // Findings endpoints
  // ---------------------------------------------------------------------------

  app.get('/api/scans/:id/runner-logs', async (c) => {
    const scanId = c.req.param('id');
    const scan = await getDB(c.env).prepare('SELECT id, project_id, user_id FROM scans WHERE id = ?')
      .bind(scanId)
      .first<{ id: string; project_id: string | null; user_id: string | null }>();
    if (!scan) {
      return c.json({ error: 'Scan not found' }, 404);
    }

    if (c.env.AUTH_ENABLED === 'true') {
      const userId = await getUserIdFromRequest(c);
      if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      if (!scan.project_id) {
        if (scan.user_id !== userId) {
          return c.json({ error: 'Forbidden' }, 403);
        }
      } else {
        const hasAccess = await checkPermission(c.env, userId, scan.project_id, 'get:/api/projects/:id/scans');
        if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
      }
    }

    const { results } = await getDB(c.env, scanId).prepare(
      "SELECT * FROM scan_events WHERE scan_id = ? AND type = 'event' AND json_extract(payload, '$.type') = 'runner_log' ORDER BY created_at ASC"
    )
      .bind(scanId)
      .all();

    const logs = results || [];

    console.log('Runner logs for', scanId, 'results:', logs.length);
    return c.json({ logs });
  });

  app.get('/api/scans/:id/findings', async (c) => {
    const scanId = c.req.param('id');
    const scan = await getDB(c.env).prepare('SELECT id, project_id, user_id FROM scans WHERE id = ?')
      .bind(scanId)
      .first<{ id: string; project_id: string | null; user_id: string | null }>();
    if (!scan) {
      return c.json({ error: 'Scan not found' }, 404);
    }

    if (c.env.AUTH_ENABLED === 'true') {
      const userId = await getUserIdFromRequest(c);
      if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      if (!scan.project_id) {
        if (scan.user_id !== userId) {
          return c.json({ error: 'Forbidden' }, 403);
        }
      } else {
        const hasAccess = await checkPermission(c.env, userId, scan.project_id, 'get:/api/projects/:id/scans');
        if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
      }
    }

    const { results } = await getDB(c.env, scanId).prepare('SELECT * FROM findings WHERE scan_id = ?')
      .bind(scanId)
      .all();

    return c.json({ findings: results || [] });
  });

  app.get('/api/findings/:id', async (c) => {
    const findingId = c.req.param('id');
    // JOIN with scans to retrieve project_id (findings table has no project_id column)
    const row = await getDB(c.env, findingId).prepare(
      'SELECT f.*, s.project_id, s.user_id FROM findings f JOIN scans s ON f.scan_id = s.id WHERE f.id = ?'
    )
      .bind(findingId)
      .first<{ project_id: string | null; user_id: string | null }>();

    if (!row) {
      return c.json({ error: 'Finding not found' }, 404);
    }

    if (c.env.AUTH_ENABLED === 'true') {
      const userId = await getUserIdFromRequest(c);
      if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      if (!row.project_id) {
        if (row.user_id !== userId) {
          return c.json({ error: 'Forbidden' }, 403);
        }
      } else {
        const hasAccess = await checkPermission(c.env, userId, row.project_id, 'get:/api/projects/:id/scans');
        if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
      }
    }

    return c.json({ finding: row });
  });

  app.patch('/api/findings/:id', async (c) => {
    const findingId = c.req.param('id');
    const body = await c.req.json();

    // JOIN with scans to retrieve project_id (findings table has no project_id column)
    const finding = await getDB(c.env, findingId).prepare(
      'SELECT f.id, s.project_id, s.user_id FROM findings f JOIN scans s ON f.scan_id = s.id WHERE f.id = ?'
    )
      .bind(findingId)
      .first<{ id: string; project_id: string | null; user_id: string | null }>();

    if (!finding) {
      return c.json({ error: 'Finding not found' }, 404);
    }

    if (c.env.AUTH_ENABLED === 'true') {
      const userId = await getUserIdFromRequest(c);
      if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      if (!finding.project_id) {
        if (finding.user_id !== userId) {
          return c.json({ error: 'Forbidden' }, 403);
        }
      } else {
        const hasAccess = await checkPermission(c.env, userId, finding.project_id, 'post:/api/projects/:id/scans');
        if (!hasAccess) return c.json({ error: 'Forbidden' }, 403);
      }
    }
  
    const allowedFields = [
      'ai_status',
      'ai_relevance',
      'ai_explanation',
      'ai_remediation',
      'ai_proposed_patch',
      'pr_link'
    ] as const;

    const setClauses: string[] = [];
    const values: (string | null)[] = [];
  
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        setClauses.push(`${field} = ?`);
        values.push(body[field]);
      }
    }
  
    if (setClauses.length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400);
    }
  
    values.push(findingId);
    await getDB(c.env, findingId).prepare(`UPDATE findings SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  
    const updated = await getDB(c.env, findingId).prepare('SELECT * FROM findings WHERE id = ?')
      .bind(findingId)
      .first();
  
    return c.json({ finding: updated });
  });
  
}
