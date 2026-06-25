export async function cleanupExpiredGuests(db: any): Promise<void> {
  try {
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
      "SELECT id, username FROM users WHERE delete_requested_at IS NOT NULL AND delete_requested_at < datetime('now', '-7 days') LIMIT 10"
    ).all<{ id: string; username: string }>();

    if (!expiredDeletions.results || expiredDeletions.results.length === 0) {
      return;
    }

    console.log(`Found ${expiredDeletions.results.length} accounts to permanently delete (grace period expired).`);

    for (const user of expiredDeletions.results) {
      const userId = user.id;

      // Fetch projects owned by the user to prevent deleting shared projects owned by others
      const { results: ownedProjects } = await env.DB.prepare(
        "SELECT project_id FROM project_members WHERE user_id = ? AND role = 'owner'"
      ).bind(userId).all<{ project_id: string }>();

      const ownedProjectIds = ownedProjects ? ownedProjects.map(p => p.project_id) : [];

      // a. Fetch scan report URL R2 objects associated with the user
      // We only delete scans that the user created, OR scans in projects owned by the user.
      let scansQuery = "SELECT report_url FROM scans WHERE user_id = ?";
      const scansParams: any[] = [userId];

      if (ownedProjectIds.length > 0) {
        const placeholders = ownedProjectIds.map(() => '?').join(',');
        scansQuery += ` OR project_id IN (${placeholders})`;
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

      // b. Revoke active WebSocket runner connections in Durable Object
      try {
        const doId = env.COORDINATOR_DO.idFromName('global-coordinator');
        const stub = env.COORDINATOR_DO.get(doId);
        const doRes = await stub.fetch(new Request(`http://do/revoke-user?userId=${userId}`, {
          method: 'POST'
        }));
        if (!doRes.ok) {
          console.error("Failed to revoke runner connections in DO:", await doRes.text());
        }
      } catch (doErr) {
        console.error("Failed to invoke DO /revoke-user:", doErr);
      }

      // c. Cascading delete from D1 database
      const queries = [];

      if (ownedProjectIds.length > 0) {
        const placeholders = ownedProjectIds.map(() => '?').join(',');
        queries.push(
          env.DB.prepare(`DELETE FROM scans WHERE user_id = ? OR project_id IN (${placeholders})`).bind(userId, ...ownedProjectIds),
          env.DB.prepare(`DELETE FROM scan_configs WHERE project_id IN (${placeholders})`).bind(...ownedProjectIds),
          env.DB.prepare(`DELETE FROM project_members WHERE project_id IN (${placeholders})`).bind(...ownedProjectIds),
          env.DB.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).bind(...ownedProjectIds)
        );
      } else {
        queries.push(
          env.DB.prepare("DELETE FROM scans WHERE user_id = ?").bind(userId)
        );
      }

      queries.push(
        env.DB.prepare("DELETE FROM project_members WHERE user_id = ?").bind(userId),
        env.DB.prepare("DELETE FROM runners WHERE user_id = ?").bind(userId),
        env.DB.prepare("DELETE FROM login_attempts WHERE username = ?").bind(user.username),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId)
      );

      await env.DB.batch(queries);
      console.log(`Permanently deleted user ${user.username} (${userId}) after grace period.`);
    }
  } catch (err) {
    console.error("Failed to process scheduled account deletions:", err);
  }
}

