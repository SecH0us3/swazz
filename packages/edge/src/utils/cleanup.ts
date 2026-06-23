export async function cleanupExpiredGuests(db: any): Promise<void> {
  try {
    // 1. Find all expired guest users
    const expiredGuests = await db.prepare(
      "SELECT id, username FROM users WHERE is_guest = 1 AND expires_at < datetime('now')"
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
