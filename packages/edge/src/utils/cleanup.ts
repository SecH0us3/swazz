import type { D1Database } from '@cloudflare/workers-types';
import { logInfo, logWarn, logError } from '../../../common/logging/logger';
import { hashApiKey } from './auth';
import { CleanupRepository } from '../repositories/cleanup';
import type { Env } from '../env';

export async function cleanupSecurityTables(db: D1Database, env?: any): Promise<void> {
  try {
    const repo = new CleanupRepository({ DB: db } as any);
    const changes = await repo.cleanupSecurityTables();

    if (changes.challenges > 0) {
      logInfo(env, "Cleanup", `Cleaned up ${changes.challenges} expired login challenges.`);
    }
    if (changes.rateLimits > 0) {
      logInfo(env, "Cleanup", `Cleaned up ${changes.rateLimits} expired rate limits.`);
    }
    if (changes.loginHistory > 0) {
      logInfo(env, "Cleanup", `Cleaned up ${changes.loginHistory} user login history logs older than 90 days.`);
    }
    if (changes.auditLogs > 0) {
      logInfo(env, "Cleanup", `Cleaned up ${changes.auditLogs} audit logs older than 45 days.`);
    }
  } catch (err) {
    logError(env, "Cleanup", "Failed to clean up security tables", { error: err });
  }
}

export async function cleanupExpiredGuests(db: D1Database, env?: any): Promise<void> {
  try {
    // Run security tables cleanup at the same time
    await cleanupSecurityTables(db, env);

    const repo = new CleanupRepository({ DB: db } as any);
    const expiredGuests = await repo.getExpiredGuestUsers();

    if (expiredGuests.length === 0) {
      return;
    }

    logInfo(env, "Cleanup", `Found ${expiredGuests.length} expired guest users to clean up.`);

    for (const user of expiredGuests) {
      const projectIds = await repo.getProjectsOwnedByUser(user.id);
      await repo.deleteGuestUserData(user.id, projectIds, user.username);
    }
    logInfo(env, "Cleanup", "Cleanup of expired guest users completed successfully.");
  } catch (err) {
    logError(env, "Cleanup", "Failed to clean up expired guest users", { error: err });
  }
}

export async function cleanupScheduledDeletions(env: Env): Promise<void> {
  try {
    const repo = new CleanupRepository(env);
    const expiredDeletions = await repo.getExpiredScheduledDeletions();

    if (expiredDeletions.length === 0) {
      return;
    }

    const userIds = expiredDeletions.map(u => u.id);
    const usernames = expiredDeletions.map(u => u.username);

    logInfo(env, "Cleanup", `Found ${userIds.length} accounts to permanently delete (grace period expired).`);

    // 1. Fetch projects owned by these users (to cascade delete owned projects/scans)
    const ownedProjectIds = await repo.getProjectsOwnedByUsers(userIds);

    // 2. Fetch and delete R2 scan reports
    const reportUrls = await repo.getScanReportUrls(userIds, ownedProjectIds);
    for (const url of reportUrls) {
      try {
        await env.STORAGE.delete(url);
      } catch (r2Err) {
        logError(env, "Cleanup", `Failed to delete R2 report object ${url}`, { error: r2Err });
      }
    }

    // 3. Revoke active WebSocket runner connections in Durable Object in parallel
    await Promise.all(userIds.map(async (userId) => {
      try {
        const doId = env.COORDINATOR_DO.idFromName('global-coordinator');
        const stub = env.COORDINATOR_DO.get(doId);
        const doRes = await stub.fetch(new Request(`http://do/revoke-user?userId=${userId}`, {
          method: 'POST'
        }) as any);
        if (!doRes.ok) {
          logError(env, "Cleanup", `Failed to revoke runner connections in DO for user ${userId}`, { error: await doRes.text() });
        }
      } catch (doErr) {
        logError(env, "Cleanup", `Failed to invoke DO /revoke-user for user ${userId}`, { error: doErr });
      }
    }));

    // 4. Fetch API keys for KV cache invalidation before deleting users
    let apiKeysToInvalidate: string[] = [];
    try {
      apiKeysToInvalidate = await repo.getUserApiKeys(userIds);
    } catch {
      // Non-critical — proceed with deletion even if key fetch fails
    }

    // 5. Cascading batch delete from D1 database
    await repo.deleteUsersData(userIds, ownedProjectIds, usernames);

    // 6. Invalidate deleted users' API keys from KV session cache
    const kv = env.SESSION_CACHE;
    if (kv && apiKeysToInvalidate.length > 0) {
      try {
        const chunkSize = 10;
        for (let i = 0; i < apiKeysToInvalidate.length; i += chunkSize) {
          const chunk = apiKeysToInvalidate.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async key => {
            const cacheKey = key.startsWith('swazz_live_') ? await hashApiKey(key) : key;
            await kv.delete(`apikey:${cacheKey}`);
          }));
        }
      } catch {
        // KV cleanup failed — non-critical
      }
    }

    logInfo(env, "Cleanup", `Permanently deleted ${userIds.length} users after grace period.`);
  } catch (err) {
    logError(env, "Cleanup", "Failed to process scheduled account deletions", { error: err });
  }
}
