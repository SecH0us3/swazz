// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { RouteHandler, HandlerContext } from './types';

// An MCP SSE connection belongs to the user who opened it (routes/mcp.ts): only that user's
// messages are answered on it. Knowing a connectionId (it travels in the endpoint URL, which ends
// up in logs) must not let anyone else write into the stream, where its client takes every
// message for an answer of the server it trusts.

/** The connection, if it exists and was opened by userId; undefined otherwise, alike. */
function ownedStream(context: HandlerContext, connectionId: string, userId: string | null): ReadableStreamDefaultController | undefined {
  const stream = context.stateManager.sseStreams.get(connectionId);
  return stream && userId && stream.userId === userId ? stream.controller : undefined;
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

    const origin = decodeURIComponent(url.searchParams.get('origin') || '');
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

/** 204 if the caller (userId) may send on the connection, 404 otherwise. */
export class SseOwnerHandler implements RouteHandler {
  async handle(_request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const connectionId = url.searchParams.get('connectionId');
    if (!connectionId) {
      return new Response('Missing connectionId', { status: 400 });
    }
    return ownedStream(context, connectionId, url.searchParams.get('userId'))
      ? new Response(null, { status: 204 })
      : new Response('Connection not found', { status: 404 });
  }
}

export class SseSendHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const connectionId = url.searchParams.get('connectionId');
    if (!connectionId) {
      return new Response('Missing connectionId', { status: 400 });
    }

    // Someone else's connection is answered exactly like a missing one.
    const controller = ownedStream(context, connectionId, url.searchParams.get('userId'));
    if (!controller) {
      return new Response('Connection not found', { status: 404 });
    }

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
