// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { RouteHandler, HandlerContext } from './types';

export class RevokeUserHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response('Missing userId', { status: 400 });
    }

    const userIdTag = `user_id:${userId}`;
    let disconnectedCount = 0;

    for (const ws of context.state.getWebSockets()) {
      const tags = context.state.getTags(ws);
      if (tags.includes(userIdTag)) {
        try {
          ws.close(1008, "User account deleted");
        } catch {
          // ignore
        }
        context.stateManager.runners.delete(ws);
        disconnectedCount++;
      }
    }

    // The user's MCP SSE connections end with the account too. (Counted apart: disconnectedCount
    // is the runners'.) One the user opens after this, while other isolates have not yet seen the
    // deletion, is a non-goal: it ends when the account is purged.
    let sseClosed = 0;
    for (const [connectionId, stream] of context.stateManager.sseStreams) {
      if (stream.userId !== userId) continue;
      try {
        stream.controller.close();
      } catch {
        // already closed
      }
      context.stateManager.sseStreams.delete(connectionId);
      sseClosed++;
    }

    return new Response(JSON.stringify({ disconnectedCount, sseClosed }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
