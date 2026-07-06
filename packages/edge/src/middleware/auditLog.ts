import { Context, Next } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, getClientIp } from '../utils/auth';
import { getDB } from '../utils/db';
import { ulid } from 'ulidx';
import { PermissionKey } from '../config/rbac';

type AuditSource = 'web' | 'api_key' | 'mcp';

/**
 * Detects the source of the request:
 * - 'mcp'     : path starts with /api/mcp OR X-MCP-Client header is present
 * - 'api_key' : token starts with 'swazz_live_' (direct API call)
 * - 'web'     : JWT session token (browser UI)
 */
function detectSource(c: Context<{ Bindings: Env }>): AuditSource {
  if (c.req.path.startsWith('/api/mcp') || c.req.header('X-MCP-Client')) {
    return 'mcp';
  }
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token.startsWith('swazz_live_')) {
    return 'api_key';
  }
  return 'web';
}

/**
 * Hono middleware that logs a user action to the audit_logs table.
 * Must be placed AFTER requirePermission() so it only fires on authorised requests.
 * Uses ctx.waitUntil() for fire-and-forget DB writes — zero latency impact on responses.
 *
 * @param action  - RBAC permission key, e.g. 'patch:/api/projects/:id'
 * @param label   - Human-readable description, e.g. 'Updated project settings'
 */
export function auditLog(action: PermissionKey | string, label: string) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    await next();

    // Only log successful mutations
    if (c.res.status < 200 || c.res.status >= 300) return;

    const projectId = c.req.param('id');
    if (!projectId) return;

    const userId = await getUserIdFromRequest(c);
    const source = detectSource(c);
    const ip = getClientIp(c);

    // executionCtx may be unavailable in test environments — skip silently.
    if (!c.executionCtx?.waitUntil) return;

    c.executionCtx.waitUntil(
      (async () => {
        try {
          const db = getDB(c.env);

          const [userRow, memberRow] = await Promise.all([
            userId
              ? db.prepare('SELECT username FROM users WHERE id = ?').bind(userId).first<{ username: string }>()
              : Promise.resolve(null),
            userId && projectId
              ? db
                  .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
                  .bind(projectId, userId)
                  .first<{ role: string }>()
              : Promise.resolve(null),
          ]);

          await db
            .prepare(
              `INSERT INTO audit_logs
                 (id, project_id, user_id, actor_username, actor_role, action, action_label, source, ip_address)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              ulid(),
              projectId,
              userId ?? null,
              userRow?.username ?? null,
              memberRow?.role ?? null,
              action,
              label,
              source,
              ip ?? null
            )
            .run();
        } catch (err) {
          // Audit log write failure must never break the app — silently swallow.
          console.error('[auditLog] Failed to write audit log entry:', err);
        }
      })()
    );
  };
}
