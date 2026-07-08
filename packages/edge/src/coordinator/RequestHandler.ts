import { Env } from '../env';
import { StateManager } from './StateManager';
import { QueueService } from './QueueService';
import { RouteHandler } from './handlers/types';
import { SseHandler, SseSendHandler } from './handlers/sse';
import { RevokeUserHandler } from './handlers/users';
import { DispatchHandler, CommandHandler, StartRunHandler, ControlRunHandler } from './handlers/jobs';
import { ParseHandler } from './handlers/parse';
import { RunnersHandler, RestartRunnerHandler, ConnectRunnerHandler } from './handlers/runners';
import { ConnectClientHandler } from './handlers/connectClient';

export class RequestHandler {
  private routes: Map<string, RouteHandler>;

  constructor(
    private env: Env,
    private state: DurableObjectState,
    private stateManager: StateManager,
    private queueService: QueueService
  ) {
    this.routes = new Map<string, RouteHandler>([
      ['/sse', new SseHandler()],
      ['/sse-send', new SseSendHandler()],
      ['/revoke-user', new RevokeUserHandler()],
      ['/dispatch', new DispatchHandler()],
      ['/command', new CommandHandler()],
      ['/parse', new ParseHandler()],
      ['/start-run', new StartRunHandler()],
      ['/control-run', new ControlRunHandler()],
      ['/runners', new RunnersHandler()],
      ['/runners/restart', new RestartRunnerHandler()],
      ['/connect-runner', new ConnectRunnerHandler()],
      ['/connect-client', new ConnectClientHandler()],
    ]);
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const handler = this.routes.get(url.pathname);

    if (handler) {
      return handler.handle(request, url, {
        env: this.env,
        state: this.state,
        stateManager: this.stateManager,
        queueService: this.queueService
      });
    }

    return new Response('Not found', { status: 404 });
  }
}
