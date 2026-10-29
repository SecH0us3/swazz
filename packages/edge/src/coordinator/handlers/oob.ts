// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { RouteHandler, HandlerContext } from './types';
import { ScansRepository } from '../../repositories/scans';
import { isValidId } from '../../utils/validation';
import { logError } from '../../../../common/logging/logger';

// A run hands its unanswered tokens over just before it ends (taking them out of the runner),
// and they are written to D1 as they reach the coordinator, which can be after a callback for one
// of them. The run announces the hand-over when its grace period starts (an empty batch), so a
// callback for a run that announced or handed over within the window is looked up again after
// these delays; any other once. Retries are bounded, so the public route cannot be
// used to pile up timers: past MAX_LATE_OOB_RETRIES in flight, a callback is looked up once.
export const LATE_OOB_RETRY_WINDOW_MS = 2 * 60_000;
export const LATE_OOB_RETRY_DELAYS_MS = [5_000, 30_000];
export const MAX_LATE_OOB_RETRIES = 100;
let retriesInFlight = 0;

async function recordLateCallback(context: HandlerContext, runId: string, uuid: string, retry: boolean): Promise<void> {
  const repo = new ScansRepository(context.env);
  try {
    if (await repo.recordLateOobCallback(runId, uuid)) return;
    if (!retry || retriesInFlight >= MAX_LATE_OOB_RETRIES) return;
    retriesInFlight++;
    try {
      for (const delay of LATE_OOB_RETRY_DELAYS_MS) {
        await new Promise(resolve => setTimeout(resolve, delay));
        if (await repo.recordLateOobCallback(runId, uuid)) return;
      }
    } finally {
      retriesInFlight--;
    }
  } catch (err) {
    logError({ env: context.env, executionCtx: context.state }, 'OOB', 'Failed to record a late OOB callback', { error: err, runId });
  }
}

export class OobHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    // Expected path format: /oob/<runId>/<uuid>
    const parts = url.pathname.split('/');
    if (parts.length < 4) {
      return new Response('Invalid path', { status: 400 });
    }
    const runId = parts[2];
    const uuid = parts[3];

    // Find the runner WebSocket
    const runnerWs = context.stateManager.jobs.get(runId);
    if (runnerWs) {
      try {
        runnerWs.send(JSON.stringify({
          type: 'oob_trigger',
          payload: {
            runId,
            uuid
          }
        }));
      } catch (err) {
        console.error(`Failed to forward OOB trigger to runner:`, err);
      }
    }

    // A token the run already handed over (it ended, or is ending) is reported from D1. The
    // response does not wait for it, so it is the same whether or not the token exists. Each
    // callback costs one indexed read, and is retried only for a run that is handing over (a live
    // run's own runner matches the rest).
    if (isValidId(runId) && isValidId(uuid)) {
      const retry = context.stateManager.oobHandedOverWithin(runId, LATE_OOB_RETRY_WINDOW_MS);
      context.state.waitUntil(recordLateCallback(context, runId, uuid, retry));
    }

    return new Response('swazz-oob-received', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
