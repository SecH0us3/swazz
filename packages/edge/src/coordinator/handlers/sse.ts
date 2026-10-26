// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { RouteHandler, HandlerContext } from './types';

// An MCP SSE connection belongs to the user who opened it (routes/mcp.ts): only that user's
// messages are answered on it. Knowing a connectionId (it travels in the endpoint URL, which ends
// up in logs) must not let anyone else write into the stream, where its client takes every
// message for an answer of the server it trusts.

/**
 * The connection named by the request (connectionId), if it was opened by the caller (userId), or
 * the response to give instead: someone else's connection is answered exactly like a missing one.
 */
function ownedStream(url: URL, context: HandlerContext): { connectionId: string; controller: ReadableStreamDefaultController } | Response {
  const connectionId = url.searchParams.get('connectionId');
  if (!connectionId) {
    return new Response('Missing connectionId', { status: 400 });
  }
  const userId = url.searchParams.get('userId');
  const stream = context.stateManager.sseStreams.get(connectionId);
  if (!stream || !userId || stream.userId !== userId) {
    return new Response('Connection not found', { status: 404 });
  }
  return { connectionId, controller: stream.controller };
}

export class SseHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const connectionId = url.searchParams.get('connectionId');
    if (!connectionId) {
      return new Response('Missing connectionId', { status: 400 });
    }
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response('Missing userId', { status: 400 });
    }

    const origin = url.searchParams.get('origin') || '';
    const stream = new ReadableStream({
      start: (controller) => {
        context.stateManager.sseStreams.set(connectionId, { controller, userId });
        const endpointUrl = `${origin}/api/mcp/message?connectionId=${connectionId}`;
        const initEvent = `event: endpoint\ndata: ${endpointUrl}\n\n`;
        controller.enqueue(new TextEncoder().encode(initEvent));
      },
      cancel: () => {
        context.stateManager.sseStreams.delete(connectionId);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });
  }
}

/** 204 if the caller (userId) may send on the connection; see ownedStream otherwise. */
export class SseOwnerHandler implements RouteHandler {
  async handle(_request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const owned = ownedStream(url, context);
    return owned instanceof Response ? owned : new Response(null, { status: 204 });
  }
}

export class SseSendHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const owned = ownedStream(url, context);
    if (owned instanceof Response) {
      return owned;
    }
    const { connectionId, controller } = owned;

    try {
      const body = await request.text();
      controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${body}\n\n`));
    } catch (err) {
      context.stateManager.sseStreams.delete(connectionId);
      return new Response('Connection closed', { status: 410 });
    }
    return new Response('Sent', { status: 200 });
  }
}
