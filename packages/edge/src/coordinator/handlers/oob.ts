// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { RouteHandler, HandlerContext } from './types';

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

    return new Response('swazz-oob-received', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
