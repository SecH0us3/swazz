// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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
