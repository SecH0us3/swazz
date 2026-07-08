import { Env } from './env';
import { StateManager } from './coordinator/StateManager';
import { RequestHandler } from './coordinator/RequestHandler';
import { WebSocketHandler } from './coordinator/WebSocketHandler';
import { QueueService } from './coordinator/QueueService';

export class RunnerCoordinator {
  state: DurableObjectState;
  env: Env;
  
  private stateManager: StateManager;
  private requestHandler: RequestHandler;
  private webSocketHandler: WebSocketHandler;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    
    this.stateManager = new StateManager(state);
    const queueService = new QueueService(env, state, this.stateManager);
    
    this.requestHandler = new RequestHandler(env, state, this.stateManager, queueService);
    this.webSocketHandler = new WebSocketHandler(env, state, this.stateManager, queueService);
  }

  async fetch(request: Request): Promise<Response> {
    return this.requestHandler.handle(request);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return this.webSocketHandler.handleMessage(ws, message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    return this.webSocketHandler.handleClose(ws, code, reason, wasClean);
  }

  async webSocketError(ws: WebSocket, error: any): Promise<void> {
    return this.webSocketHandler.handleError(ws, error);
  }
}
