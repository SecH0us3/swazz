// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { RouteHandler, HandlerContext } from './types';
import { ScansRepository } from '../../repositories/scans';

export class ConnectClientHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const runId = url.searchParams.get('runId');
    if (!runId) return new Response('Missing runId', { status: 400 });

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    context.state.acceptWebSocket(server, ["client", runId]);
    
    if (!context.stateManager.clients.has(runId)) {
      context.stateManager.clients.set(runId, new Set());
    }
    context.stateManager.clients.get(runId)!.add(server);

    const scansRepo = new ScansRepository(context.env);
    if (typeof scansRepo.getScan === 'function') {
      const scan = await scansRepo.getScan(runId);
      if (scan && (scan.status === 'completed' || scan.status === 'failed')) {
        try {
          let stats: any = {};
          if (scan.summary_stats) {
            stats = typeof scan.summary_stats === 'string' ? JSON.parse(scan.summary_stats) : scan.summary_stats;
          }
          server.send(JSON.stringify({
            type: scan.status === 'completed' ? 'complete' : 'error',
            data: stats
          }));
        } catch (e) {
          // ignore send error
        }
      }
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
