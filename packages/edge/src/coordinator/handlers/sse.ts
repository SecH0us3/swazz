import { RouteHandler, HandlerContext } from './types';

export class SseHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const connectionId = url.searchParams.get('connectionId');
    if (!connectionId) {
      return new Response('Missing connectionId', { status: 400 });
    }

    const origin = decodeURIComponent(url.searchParams.get('origin') || '');
    const stream = new ReadableStream({
      start: (controller) => {
        context.stateManager.sseStreams.set(connectionId, controller);
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

export class SseSendHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const connectionId = url.searchParams.get('connectionId');
    if (!connectionId) {
      return new Response('Missing connectionId', { status: 400 });
    }

    const controller = context.stateManager.sseStreams.get(connectionId);
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
