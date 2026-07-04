import { Env } from '../env';
import { getDB } from './db';

function matchCronField(pattern: string, value: number, min: number, max: number): boolean {
  if (pattern === '*') return true;
  
  const parts = pattern.split(',');
  for (const part of parts) {
    if (part === '*') return true;
    
    const stepSplit = part.split('/');
    const rangeExpr = stepSplit[0];
    const step = stepSplit[1] ? parseInt(stepSplit[1], 10) : 1;
    
    let start = min;
    let end = max;
    
    if (rangeExpr === '*') {
      // Keep min and max
    } else if (rangeExpr.includes('-')) {
      const rangeSplit = rangeExpr.split('-');
      start = parseInt(rangeSplit[0], 10);
      end = parseInt(rangeSplit[1], 10);
    } else {
      start = parseInt(rangeExpr, 10);
      end = start;
    }
    
    if (value >= start && value <= end && (value - start) % step === 0) {
      return true;
    }
  }
  return false;
}

export function cronMatches(cronExpr: string, date: Date): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1; // 1-indexed
  const dayOfWeek = date.getUTCDay(); // 0-6
  
  return (
    matchCronField(parts[0], minute, 0, 59) &&
    matchCronField(parts[1], hour, 0, 23) &&
    matchCronField(parts[2], dayOfMonth, 1, 31) &&
    matchCronField(parts[3], month, 1, 12) &&
    matchCronField(parts[4], dayOfWeek, 0, 6)
  );
}

export async function handleScheduledScans(env: Env): Promise<void> {
  const db = getDB(env);
  const now = new Date();
  
  const { results: configs } = await db.prepare(
    "SELECT id, project_id, name, config_json, cron_schedule, last_run_at FROM scan_configs WHERE cron_schedule IS NOT NULL"
  ).all<{ id: string; project_id: string; name: string; config_json: string; cron_schedule: string; last_run_at: string | null }>();
  
  // 1. Filter configs locally first to minimize D1 subrequests and CPU time inside loop
  const matchingConfigs = configs.filter(config => {
    if (config.last_run_at) {
      const lastRun = new Date(config.last_run_at);
      if (now.getTime() - lastRun.getTime() < 50000) {
        return false; // Already ran in this minute, skip to prevent double run
      }
    }
    return cronMatches(config.cron_schedule, now);
  });
  
  for (const config of matchingConfigs) {
    try {
      // Query project owners
      const { results: owners } = await db.prepare(`
        SELECT u.id, u.public_key, u.plan
        FROM project_members pm
        JOIN users u ON pm.user_id = u.id
        WHERE pm.project_id = ? AND pm.role = 'owner'
      `).bind(config.project_id).all<{ id: string; public_key: string | null; plan: string | null }>();
      
      const activeOwner = owners.find(o => o.plan === 'Supporter Plan') || owners[0];
      if (!activeOwner) {
        console.warn(`[Scheduler] Skipping scheduled scan for project ${config.project_id}: no owner found.`);
        continue;
      }
      
      const runId = crypto.randomUUID();
      const parsedConfig = JSON.parse(config.config_json || "{}") || {};
      const targetUrl = parsedConfig.base_url || "";
      const profile = (parsedConfig.settings?.profiles && parsedConfig.settings.profiles[0]) || "default";
      const status = 'queued';
      
      // Use batch transaction for database consistency
      await db.batch([
        db.prepare(
          `INSERT INTO scans (id, project_id, target_url, profile, status, user_id)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(runId, config.project_id, targetUrl, profile, status, activeOwner.id),
        db.prepare(
          "UPDATE scan_configs SET last_run_at = ? WHERE id = ?"
        ).bind(now.toISOString(), config.id)
      ]);
      
      // Send message to SCAN_QUEUE
      await env.SCAN_QUEUE.send({
        runId,
        config: parsedConfig,
        userPublicKey: activeOwner.public_key || "",
        targetUrl,
        profile,
        projectId: config.project_id,
        userId: activeOwner.id
      });
      
      console.log(`[Scheduler] Triggered scheduled scan ${runId} for project ${config.project_id}`);
    } catch (err) {
      console.error(`[Scheduler] Error processing schedule ${config.id}:`, err);
    }
  }
}
