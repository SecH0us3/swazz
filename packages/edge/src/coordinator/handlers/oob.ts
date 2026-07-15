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
