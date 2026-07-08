import { RouteHandler, HandlerContext } from './types';

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

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
