import { Env } from '../../env';
import { StateManager } from '../StateManager';
import { QueueService } from '../QueueService';

export interface HandlerContext {
  env: Env;
  state: DurableObjectState;
  stateManager: StateManager;
  queueService: QueueService;
}

export interface RouteHandler {
  handle(request: Request, url: URL, context: HandlerContext): Promise<Response>;
}
