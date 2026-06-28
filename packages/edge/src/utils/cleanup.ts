export async function cleanupSecurityTables(db: any): Promise<void> {
  try {
    const challengesRes = await db.prepare(
      "DELETE FROM login_challenges WHERE expires_at < datetime('now')"
    ).run();
    if (challengesRes.meta?.changes > 0) {
      console.log(`Cleaned up ${challengesRes.meta?.changes || 0} expired login challenges.`);
    }


    const rateLimitsRes = await db.prepare(
      "DELETE FROM rate_limits WHERE reset_at < datetime('now')"
    ).run();
    if (rateLimitsRes.meta?.changes > 0) {
      console.log(`Cleaned up ${rateLimitsRes.meta?.changes || 0} expired rate limits.`);
    }
  } catch (err) {
    console.error("Failed to clean up security tables:", err);
  }
}

export async function cleanupExpiredGuests(db: any): Promise<void> {
  try {
    // Run security tables cleanup at the same time
    await cleanupSecurityTables(db);

    // 1. Find all expired guest users
    const expiredGuests = await db.prepare(
      "SELECT id, username FROM users WHERE is_guest = 1 AND expires_at < datetime('now') LIMIT 20"
    ).all<{ id: string; username: string }>();

    if (!expiredGuests.results || expiredGuests.results.length === 0) {
      return;
    }

    console.log(`Found ${expiredGuests.results.length} expired guest users to clean up.`);

    for (const user of expiredGuests.results) {
      const userId = user.id;

      // Find projects owned by this user
      const ownedProjects = await db.prepare(
        "SELECT project_id FROM project_members WHERE user_id = ? AND role = 'owner'"
      ).bind(userId).all<{ project_id: string }>();

      const projectIds = (ownedProjects.results || []).map((p: any) => p.project_id);

      const batchStatements = [];

      // Clean up project-related data
      for (const projectId of projectIds) {
        batchStatements.push(db.prepare("DELETE FROM scans WHERE project_id = ?").bind(projectId));
        batchStatements.push(db.prepare("DELETE FROM scan_configs WHERE project_id = ?").bind(projectId));
        batchStatements.push(db.prepare("DELETE FROM project_members WHERE project_id = ?").bind(projectId));
        batchStatements.push(db.prepare("DELETE FROM projects WHERE id = ?").bind(projectId));
      }

      // Clean up user-related data
      batchStatements.push(db.prepare("DELETE FROM scans WHERE user_id = ?").bind(userId));
      batchStatements.push(db.prepare("DELETE FROM project_members WHERE user_id = ?").bind(userId));
      batchStatements.push(db.prepare("DELETE FROM runners WHERE user_id = ?").bind(userId));
      batchStatements.push(db.prepare("DELETE FROM login_attempts WHERE username = ?").bind(user.username));
      batchStatements.push(db.prepare("DELETE FROM users WHERE id = ?").bind(userId));

      if (batchStatements.length > 0) {
        await db.batch(batchStatements);
      }
    }
    console.log("Cleanup of expired guest users completed successfully.");
  } catch (err) {
    console.error("Failed to clean up expired guest users:", err);
  }
}

export async function cleanupScheduledDeletions(env: any): Promise<void> {
  try {
    // Find all users whose account deletion was requested more than 7 days ago (168 hours)
    const expiredDeletions = await env.DB.prepare(
      "SELECT id, username FROM users WHERE delete_requested_at IS NOT NULL AND delete_requested_at < datetime('now', '-7 days')"
    ).all<{ id: string; username: string }>();

    if (!expiredDeletions.results || expiredDeletions.results.length === 0) {
      return;
    }

    const userIds = expiredDeletions.results.map(u => u.id);
    const usernames = expiredDeletions.results.map(u => u.username);

    console.log(`Found ${userIds.length} accounts to permanently delete (grace period expired).`);

    // 1. Fetch projects owned by these users (to cascade delete owned projects/scans)
    const userPlaceholders = userIds.map(() => '?').join(',');
    const { results: ownedProjects } = await env.DB.prepare(
      `SELECT project_id FROM project_members WHERE role = 'owner' AND user_id IN (${userPlaceholders})`
    ).bind(...userIds).all<{ project_id: string }>();

    const ownedProjectIds = ownedProjects ? ownedProjects.map(p => p.project_id) : [];

    // 2. Fetch and delete R2 scan reports
    let scansQuery = `SELECT report_url FROM scans WHERE user_id IN (${userPlaceholders})`;
    const scansParams: any[] = [...userIds];

    if (ownedProjectIds.length > 0) {
      const projPlaceholders = ownedProjectIds.map(() => '?').join(',');
      scansQuery += ` OR project_id IN (${projPlaceholders})`;
      scansParams.push(...ownedProjectIds);
    }

    const { results: scans } = await env.DB.prepare(scansQuery)
      .bind(...scansParams)
      .all<{ report_url: string | null }>();

    if (scans && scans.length > 0) {
      for (const scan of scans) {
        if (scan.report_url) {
          try {
            await env.STORAGE.delete(scan.report_url);
          } catch (r2Err) {
            console.error(`Failed to delete R2 report object ${scan.report_url}:`, r2Err);
          }
        }
      }
    }

    // 3. Revoke active WebSocket runner connections in Durable Object in parallel
    await Promise.all(userIds.map(async (userId) => {
      try {
        const doId = env.COORDINATOR_DO.idFromName('global-coordinator');
        const stub = env.COORDINATOR_DO.get(doId);
        const doRes = await stub.fetch(new Request(`http://do/revoke-user?userId=${userId}`, {
          method: 'POST'
        }));
        if (!doRes.ok) {
          console.error(`Failed to revoke runner connections in DO for user ${userId}:`, await doRes.text());
        }
      } catch (doErr) {
        console.error(`Failed to invoke DO /revoke-user for user ${userId}:`, doErr);
      }
    }));

    // 4. Fetch API keys for KV cache invalidation before deleting users
    let apiKeysToInvalidate: string[] = [];
    try {
      const { results: apiKeyRows } = await env.DB.prepare(
        `SELECT api_key FROM users WHERE id IN (${userPlaceholders}) AND api_key IS NOT NULL`
      ).bind(...userIds).all<{ api_key: string }>();
      if (apiKeyRows) {
        apiKeysToInvalidate = apiKeyRows.map(r => r.api_key);
      }
    } catch {
      // Non-critical — proceed with deletion even if key fetch fails
    }

    // 5. Cascading batch delete from D1 database
    const queries = [];
    const usernamePlaceholders = usernames.map(() => '?').join(',');

    if (ownedProjectIds.length > 0) {
      const projPlaceholders = ownedProjectIds.map(() => '?').join(',');
      queries.push(
        env.DB.prepare(`DELETE FROM scans WHERE user_id IN (${userPlaceholders}) OR project_id IN (${projPlaceholders})`).bind(...userIds, ...ownedProjectIds),
        env.DB.prepare(`DELETE FROM scan_configs WHERE project_id IN (${projPlaceholders})`).bind(...ownedProjectIds),
        env.DB.prepare(`DELETE FROM project_members WHERE project_id IN (${projPlaceholders})`).bind(...ownedProjectIds),
        env.DB.prepare(`DELETE FROM projects WHERE id IN (${projPlaceholders})`).bind(...ownedProjectIds)
      );
    } else {
      queries.push(
        env.DB.prepare(`DELETE FROM scans WHERE user_id IN (${userPlaceholders})`).bind(...userIds)
      );
    }

    queries.push(
      env.DB.prepare(`DELETE FROM project_members WHERE user_id IN (${userPlaceholders})`).bind(...userIds),
      env.DB.prepare(`DELETE FROM runners WHERE user_id IN (${userPlaceholders})`).bind(...userIds),
      env.DB.prepare(`DELETE FROM login_attempts WHERE username IN (${usernamePlaceholders})`).bind(...usernames),
      env.DB.prepare(`DELETE FROM users WHERE id IN (${userPlaceholders})`).bind(...userIds)
    );

    await env.DB.batch(queries);

    // 6. Invalidate deleted users' API keys from KV session cache
    if (env.SESSION_CACHE && apiKeysToInvalidate.length > 0) {
      try {
        await Promise.all(apiKeysToInvalidate.map(key => env.SESSION_CACHE.delete(`apikey:${key}`)));
      } catch {
        // KV cleanup failed — non-critical
      }
    }

    console.log(`Permanently deleted ${userIds.length} users after grace period.`);
  } catch (err) {
    console.error("Failed to process scheduled account deletions:", err);
  }
}

