import { Env } from '../env';
import { ScansRepository } from '../repositories/scans';

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
  const scansRepo = new ScansRepository(env);
  const now = new Date();
  
  const configs = await scansRepo.getScheduledScanConfigs();
  
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
      const activeOwner = await scansRepo.getProjectOwnerForScan(config.project_id);
      
      if (!activeOwner) {
        console.warn(`[Scheduler] Skipping scheduled scan for project ${config.project_id}: no owner found.`);
        continue;
      }
      
      const runId = crypto.randomUUID();
      const parsedConfig = JSON.parse(config.config_json || "{}") || {};
      const targetUrl = parsedConfig.base_url || "";
      const profile = (parsedConfig.settings?.profiles && parsedConfig.settings.profiles[0]) || "default";
      const status = 'queued';
      
      await scansRepo.triggerScheduledScan(runId, config.project_id, targetUrl, profile, status, activeOwner.id, config.id, now.toISOString());
      
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
