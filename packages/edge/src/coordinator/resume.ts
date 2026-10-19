// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Handing runs back to a runner that reconnected mid-scan. Its WebSocket dropped, possibly without
// the coordinator noticing, while the agent kept the scans running; the new connection names them
// in its URL (?resume=run1,run2) and must receive their events from now on.
//
// Invariant: a connection can take over a run only if the run was dispatched to the same runner
// identity (runnerIdentity: the operator's shared pool, or one owner's runners) and has not
// finished. Naming another tenant's run id gains nothing. Non-goal: telling apart two shared
// runners, or two runners of the same owner; they are interchangeable by design.

import { Env } from '../env';
import { StateManager, MAX_ACTIVE_JOBS_PER_RUNNER } from './StateManager';
import { runnerIdentity } from './runnerAccess';
import { batchStorageGet, getFinishedScans, jobRunnerKey } from './utils';
import { isValidRunId } from '../services/scanConfigStore';
import { logWarn } from '../../../common/logging/logger';

/** Parses the ?resume= list a runner connected with; malformed ids are dropped, the list is capped. */
export function parseResumeParam(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(',').filter(isValidRunId))].slice(0, MAX_ACTIVE_JOBS_PER_RUNNER);
}

export async function resumeRuns(
  ctx: { env: Env; state: DurableObjectState; stateManager: StateManager },
  ws: WebSocket,
  runIds: unknown
): Promise<string[]> {
  const identity = runnerIdentity(ctx.state.getTags(ws));
  if (!identity || !Array.isArray(runIds)) return [];
  const requested = [...new Set(runIds.filter(isValidRunId))].slice(0, MAX_ACTIVE_JOBS_PER_RUNNER);
  if (requested.length === 0) return [];

  const owners = await batchStorageGet<string>(ctx.state.storage, requested.map(jobRunnerKey));
  const finished = await getFinishedScans(ctx.state.storage);
  const attachment = (ws.deserializeAttachment() || {}) as { activeJobs?: string[] };
  const activeJobs = Array.isArray(attachment.activeJobs) ? [...attachment.activeJobs] : [];
  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const runId of requested) {
    if (owners.get(jobRunnerKey(runId)) !== identity || finished.has(runId)) {
      rejected.push(runId);
      continue;
    }
    if (!activeJobs.includes(runId)) {
      if (activeJobs.length >= MAX_ACTIVE_JOBS_PER_RUNNER) {
        rejected.push(runId);
        continue;
      }
      activeJobs.push(runId);
    }
    const previous = ctx.stateManager.jobs.get(runId);
    if (previous && previous !== ws) {
      releaseJob(previous, runId);
    }
    ctx.stateManager.jobs.set(runId, ws);
    accepted.push(runId);
  }

  ws.serializeAttachment({ ...attachment, activeJobs });
  if (rejected.length > 0) {
    logWarn({ env: ctx.env, executionCtx: ctx.state }, "Coordinator", `Runner tried to resume ${rejected.length} run(s) not dispatched to it`, { rejected });
  }
  return accepted;
}

/** Removes a run from a (dead) socket's attachment, so a later state rebuild does not bring it back. */
function releaseJob(ws: WebSocket, runId: string): void {
  try {
    const att = (ws.deserializeAttachment() || {}) as { activeJobs?: string[] };
    if (Array.isArray(att.activeJobs) && att.activeJobs.includes(runId)) {
      ws.serializeAttachment({ ...att, activeJobs: att.activeJobs.filter(id => id !== runId) });
    }
  } catch { /* socket already gone */ }
}
