# Design Spec: Coordinator Refactoring

**Date:** 2026-07-08
**Status:** Draft / Proposed

## Objective
Refactor the large `packages/edge/src/Coordinator.ts` (~940 lines) to split it into cohesive, single-purpose classes. This improves maintainability, readability, and makes the logical parts of the coordinator testable via simple unit tests without requiring full Worker / Durable Object integration test overhead.

## Proposed File Structure
All new components will live inside a subfolder:
- `packages/edge/src/coordinator/`
  - [StateManager.ts](file:///Users/alex/src/swazz/packages/edge/src/coordinator/StateManager.ts) — Holds in-memory collections of active connections (runners, clients, jobs, pending challenges/parses) and state reconstruction logic.
  - [RequestHandler.ts](file:///Users/alex/src/swazz/packages/edge/src/coordinator/RequestHandler.ts) — Handles HTTP request routing (`/sse`, `/dispatch`, `/parse`, etc.).
  - [WebSocketHandler.ts](file:///Users/alex/src/swazz/packages/edge/src/coordinator/WebSocketHandler.ts) — Processes WebSocket lifecycle events and incoming messages (challenge response, parsing results, findings).
  - [QueueService.ts](file:///Users/alex/src/swazz/packages/edge/src/coordinator/QueueService.ts) — Handles logic for polling/fetching queued scans and dispatching them to compatible runners.
  - [utils.ts](file:///Users/alex/src/swazz/packages/edge/src/coordinator/utils.ts) — Outdated version check functions.

The entry point [Coordinator.ts](file:///Users/alex/src/swazz/packages/edge/src/Coordinator.ts) will remain as the thin wrapper implementing the `DurableObject` interface:
```typescript
import { StateManager } from './coordinator/StateManager';
import { RequestHandler } from './coordinator/RequestHandler';
import { WebSocketHandler } from './coordinator/WebSocketHandler';
import { QueueService } from './coordinator/QueueService';
import { Env } from './env';

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
```

---

## Component Specifications

### 1. `StateManager`
- **Responsibility:** Restoring and holding transient memory states.
- **Methods:**
  - `reconstructState()`: Iterates over `state.getWebSockets()` to populate mappings based on tags and attachments.
  - `isPrivateRunner(ws)`: Helper checking WebSocket tags.

### 2. `RequestHandler`
- **Responsibility:** Handles HTTP requests routed to the DO.
- **Key Methods:**
  - `handle(request)`: Routes to private sub-methods depending on `pathname`.
  - `handleSse(url)` / `handleSseSend(url, request)`
  - `handleRevokeUser(url)`
  - `handleDispatch(request)`
  - `handleCommand(request)`
  - `handleParse(request)`
  - `handleStartRun(url, request)`
  - `handleControlRun(url)`
  - `handleListRunners()`
  - `handleRestartRunner(url)`
  - `handleConnectRunner(url, request)`
  - `handleConnectClient(url)`

### 3. `WebSocketHandler`
- **Responsibility:** Handles WebSocket lifecycle.
- **Key Methods:**
  - `handleMessage(ws, message)`: Distinguishes between pending runners (challenge-response) and authenticated runners.
  - `handlePendingRunnerMessage(ws, message, tags)`: Verifies Ed25519 signature of challenge nonce.
  - `handleRunnerMessage(ws, message)`: Handles `parse_result`, `event`, and `error` payloads. Enqueues scans findings into `FINDINGS_QUEUE` and updates storage.
  - `handleClose(ws, code, reason, wasClean)`: Clears mapping lists.

### 4. `QueueService`
- **Responsibility:** Checks queued scans and attempts to assign them to matching runners.
- **Key Methods:**
  - `checkAndDispatchQueuedScans(ws)`

---

## Unit Testing Strategy

We will write dedicated unit tests under `packages/edge/test/unit/coordinator/`:
1. `state.test.ts` - Verify state manager correctly parses attachments and tags to rebuild state.
2. `request.test.ts` - Mock `DurableObjectState` storage and input requests, verify routing and response generation.
3. `websocket.test.ts` - Test challenge-response signature checking, background queue sending, and parsing results.
4. `queue.test.ts` - Verify compatible/non-compatible scan routing logic using mocked database results.

We will use standard Vitest mocking utilities to create mock environments, eliminating the need to spin up the actual Durable Object worker environment for logic tests.

## Backward Compatibility & Integration
- Existing Integration tests in `packages/edge/test/index.test.ts` must pass without any modifications. The external API, class name `RunnerCoordinator`, and behavior remain exactly identical.
- No changes to Wrangler D1/R2/Queue configurations are required.
