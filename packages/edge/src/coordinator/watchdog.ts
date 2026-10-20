// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Stalled scan watchdog. A dispatched (or paused) scan whose runner went away is normally taken
// over: the runner resumes it on reconnect (resume.ts), or the queue hands it to another runner.
// When neither happens, nothing would ever end it, and the dashboard would show it running
// forever. The watchdog ends such a scan as failed, with a reason the user can act on:
//  - no connected runner owns it: once D1 has had no event of it for STALLED_IDLE_MINUTES and no
//    runner has owned it on any watchdog pass for UNOWNED_GRACE_MS, so a runner that is
//    reconnecting keeps its scan. When each scan was first seen unowned is kept in DO storage:
//    the coordinator hibernates between passes, which wipes its memory;
//  - a connected runner owns it but the scan has reported nothing for SILENT_OWNED_MINUTES (hung,
//    or never sent its terminal event): the runner is told to stop it. Paused scans are quiet by
//    design and left alone.
// A scan that ended in the meantime is left as it is: its first terminal event wins.
// Invoked every minute by the Worker's cron (index.ts) through the internal /watchdog route.

import { HandlerContext, RouteHandler } from './handlers/types';
import { ScansRepository } from '../repositories/scans';
import { clearScanState, forgetJobRunner } from './utils';
import { logError } from '../../../common/logging/logger';

export const STALLED_IDLE_MINUTES = 10;
export const UNOWNED_GRACE_MS = 5 * 60_000;
export const SILENT_OWNED_MINUTES = 60;
const WATCHDOG_BATCH = 50;
export const UNOWNED_SINCE_KEY = 'watchdog_unowned_since';

export const STALLED_SCAN_MESSAGE =
  'The runner executing this scan stopped responding, and no runner took the scan over. ' +
  'Start the scan again once a runner is connected (Settings → Runners).';

export const SILENT_SCAN_MESSAGE =
  `The scan reported no progress for ${SILENT_OWNED_MINUTES} minutes, so it was stopped. ` +
  'Start it again; if this keeps happening, update the runner.';

/** Ends the stalled scans it has watched long enough; returns their ids. */
export async function failStalledScans(context: HandlerContext, now: number = Date.now()): Promise<string[]> {
  const { env, state, stateManager } = context;
  stateManager.pruneDeadRunners(now);
  const repo = new ScansRepository(env);
  const candidates = await repo.getStalledActiveScans(STALLED_IDLE_MINUTES, WATCHDOG_BATCH);

  const stored = (await state.storage.get<Record<string, number>>(UNOWNED_SINCE_KEY)) ?? {};
  // Only current candidates are kept, so the record stays bounded by the batch size.
  const unownedSince: Record<string, number> = {};
  const failed: string[] = [];
  for (const scan of candidates) {
    try {
      const runner = stateManager.jobs.get(scan.id);
      if (runner) {
        if (scan.status === 'dispatched' && scan.idle_minutes >= SILENT_OWNED_MINUTES && await endScan(context, repo, scan.id, SILENT_SCAN_MESSAGE)) {
          stopOnRunner(context, runner, scan.id);
          failed.push(scan.id);
        }
        continue;
      }
      const since = typeof stored[scan.id] === 'number' ? stored[scan.id] : now;
      if (now - since < UNOWNED_GRACE_MS) {
        unownedSince[scan.id] = since;
        continue;
      }
      if (await endScan(context, repo, scan.id, STALLED_SCAN_MESSAGE)) failed.push(scan.id);
    } catch (err) {
      logError({ env, executionCtx: state }, 'Coordinator', `Failed to end stalled scan ${scan.id}`, { error: err });
    }
  }
  if (Object.keys(unownedSince).length > 0) {
    await state.storage.put(UNOWNED_SINCE_KEY, unownedSince);
  } else if (Object.keys(stored).length > 0) {
    await state.storage.delete(UNOWNED_SINCE_KEY);
  }
  return failed;
}

/** Fails the scan with the reason; false if it ended in the meantime. */
async function endScan(context: HandlerContext, repo: ScansRepository, runId: string, reason: string): Promise<boolean> {
  // A scan that ended since the lookup keeps its own end (and no stray error in its log).
  const status = await repo.getScanStatus(runId);
  if (status !== 'dispatched' && status !== 'paused') return false;
  // Stored like a runner error, so it is the reason shown on the dashboard, in the runner log
  // and in the scan history; the update applies only to a scan still active, and fires the
  // scan.failed webhook only if it did.
  const { ended } = await repo.processFindingsQueueMessages([{ body: { scanId: runId, type: 'error', payload: { error: reason } } }]);
  if (!ended.includes(runId)) return false;
  await clearScanState(context.state.storage, runId);
  await forgetJobRunner(context.state.storage, runId);

  const message = JSON.stringify({ type: 'error', data: { message: reason } });
  for (const client of context.stateManager.clients.get(runId) ?? []) {
    try {
      client.send(message);
    } catch { /* the dashboard is gone; it reads the reason when it comes back */ }
  }
  return true;
}

/** Tells the runner of a scan the watchdog ended to stop it, and stops accepting its events. */
function stopOnRunner(context: HandlerContext, runner: WebSocket, runId: string): void {
  try {
    runner.send(JSON.stringify({ type: 'job_command', payload: { runId, command: 'stop' } }));
  } catch { /* the connection is gone */ }
  context.stateManager.jobs.delete(runId);
  const attachment = (runner.deserializeAttachment?.() || {}) as { activeJobs?: string[] };
  if (attachment.activeJobs?.includes(runId)) {
    runner.serializeAttachment({ ...attachment, activeJobs: attachment.activeJobs.filter(id => id !== runId) });
  }
}

export class WatchdogHandler implements RouteHandler {
  async handle(_request: Request, _url: URL, context: HandlerContext): Promise<Response> {
    const failed = await failStalledScans(context);
    return Response.json({ failed: failed.length });
  }
}
