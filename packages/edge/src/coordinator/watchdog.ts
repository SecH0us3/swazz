// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Stalled scan watchdog. A dispatched (or paused) scan whose runner went away is normally taken
// over: the runner resumes it on reconnect (resume.ts), or the queue hands it to another runner.
// When neither happens, nothing would ever end it, and the dashboard would show it running
// forever. The watchdog ends such a scan as failed, with a reason the user can act on.
//
// A scan is ended only when both hold, so a runner that is reconnecting keeps its scan:
//  - D1 has had no event of it for STALLED_IDLE_MINUTES, and
//  - no connected runner has owned it on any watchdog pass for UNOWNED_GRACE_MS.
// Invoked every minute by the Worker's cron (index.ts) through the internal /watchdog route.

import { HandlerContext, RouteHandler } from './handlers/types';
import { ScansRepository } from '../repositories/scans';
import { clearScanState, forgetJobRunner } from './utils';
import { logError } from '../../../common/logging/logger';

export const STALLED_IDLE_MINUTES = 10;
export const UNOWNED_GRACE_MS = 5 * 60_000;
const WATCHDOG_BATCH = 50;

export const STALLED_SCAN_MESSAGE =
  'The runner executing this scan stopped responding, and no runner took the scan over. ' +
  'Start the scan again once a runner is connected (Settings → Runners).';

/** Ends the stalled scans it has watched long enough; returns their ids. */
export async function failStalledScans(context: HandlerContext, now: number = Date.now()): Promise<string[]> {
  const { env, state, stateManager } = context;
  stateManager.pruneDeadRunners(now);
  const repo = new ScansRepository(env);
  const candidates = await repo.getStalledActiveScans(STALLED_IDLE_MINUTES, WATCHDOG_BATCH);

  const watched = stateManager.unownedSince;
  const current = new Set(candidates);
  for (const runId of [...watched.keys()]) {
    if (!current.has(runId)) watched.delete(runId);
  }

  const failed: string[] = [];
  for (const runId of candidates) {
    if (stateManager.jobs.has(runId)) {
      watched.delete(runId);
      continue;
    }
    const since = watched.get(runId);
    if (since === undefined) {
      watched.set(runId, now);
      continue;
    }
    if (now - since < UNOWNED_GRACE_MS) continue;
    watched.delete(runId);
    try {
      if (await failStalledScan(context, repo, runId)) failed.push(runId);
    } catch (err) {
      logError({ env, executionCtx: state }, 'Coordinator', `Failed to end stalled scan ${runId}`, { error: err });
    }
  }
  return failed;
}

async function failStalledScan(context: HandlerContext, repo: ScansRepository, runId: string): Promise<boolean> {
  // Conditional on the scan still being active: a late "complete" that got there first wins.
  if (!(await repo.markFailedIfActive(runId))) return false;
  // Stored like a runner error, so it is the reason shown on the dashboard, in the runner log
  // and in the scan history; this also fires the scan.failed webhook.
  await repo.processFindingsQueueMessages([{ body: { scanId: runId, type: 'error', payload: { error: STALLED_SCAN_MESSAGE } } }]);
  await clearScanState(context.state.storage, runId);
  await forgetJobRunner(context.state.storage, runId);

  const message = JSON.stringify({ type: 'error', data: { message: STALLED_SCAN_MESSAGE } });
  for (const client of context.stateManager.clients.get(runId) ?? []) {
    try {
      client.send(message);
    } catch { /* the dashboard is gone; it reads the reason when it comes back */ }
  }
  return true;
}

export class WatchdogHandler implements RouteHandler {
  async handle(_request: Request, _url: URL, context: HandlerContext): Promise<Response> {
    const failed = await failStalledScans(context);
    return Response.json({ failed: failed.length });
  }
}
