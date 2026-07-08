# Coordinator Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the large `Coordinator.ts` in `packages/edge/src/` into smaller modular classes inside `packages/edge/src/coordinator/` for clean structure and easier unit testing.

**Architecture:** Extraction of concerns into dedicated classes (`StateManager`, `QueueService`, `WebSocketHandler`, `RequestHandler`) with dependency injection, while `RunnerCoordinator` remains a thin facade DO class.

**Tech Stack:** TypeScript, Cloudflare Durable Objects, Vitest.

## Global Constraints
- Existing integration tests in `packages/edge/test/index.test.ts` must pass.
- Do not change any configuration in `wrangler.toml`.
- Avoid inline layout styles (per swazz global rules).
- Keep file paths absolute and check changes at each step.

---

### Task 1: Extract and Test Version Checking Utility (`utils.ts`)

**Files:**
- Create: `packages/edge/src/coordinator/utils.ts`
- Test: `packages/edge/test/unit/coordinator/utils.test.ts`

**Interfaces:**
- Produces: `isVersionOutdated(runnerVer: string, coordVer: string): boolean`

- [ ] **Step 1: Create `packages/edge/src/coordinator/utils.ts`**
  Write the version comparison function:
  ```typescript
  export function isVersionOutdated(runnerVer: string, coordVer: string): boolean {
    if (typeof runnerVer !== 'string') {
      throw new TypeError('runnerVer must be a string');
    }
    if (typeof coordVer !== 'string') {
      throw new TypeError('coordVer must be a string');
    }
    if (runnerVer === 'dev' || coordVer === 'dev') return false;
    
    const cleanRunner = runnerVer.replace(/^v\.?/, '');
    const cleanCoord = coordVer.replace(/^v\.?/, '');
    
    const [runnerRelease, runnerPre] = cleanRunner.split('-');
    const [coordRelease, coordPre] = cleanCoord.split('-');
    
    const runnerParts = runnerRelease.split('.').map(Number);
    const coordParts = coordRelease.split('.').map(Number);
    
    for (let i = 0; i < Math.max(runnerParts.length, coordParts.length); i++) {
      const r = runnerParts[i] || 0;
      const c = coordParts[i] || 0;
      if (isNaN(r) || isNaN(c)) {
        if (runnerRelease < coordRelease) return true;
        if (runnerRelease > coordRelease) return false;
        break;
      }
      if (r < c) return true;
      if (r > c) return false;
    }
    
    if (runnerPre && !coordPre) return true;
    if (!runnerPre && coordPre) return false;
    if (runnerPre && coordPre) {
      return runnerPre < coordPre;
    }
    
    return false;
  }
  ```

- [ ] **Step 2: Create unit tests in `packages/edge/test/unit/coordinator/utils.test.ts`**
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { isVersionOutdated } from '../../../src/coordinator/utils';

  describe('isVersionOutdated', () => {
    it('returns false if either version is dev', () => {
      expect(isVersionOutdated('dev', '1.0.0')).toBe(false);
      expect(isVersionOutdated('1.0.0', 'dev')).toBe(false);
    });

    it('returns true if runner version is older', () => {
      expect(isVersionOutdated('1.0.0', '1.1.0')).toBe(true);
      expect(isVersionOutdated('1.0.0', '2.0.0')).toBe(true);
      expect(isVersionOutdated('v1.0.0', '1.0.1')).toBe(true);
    });

    it('returns false if runner version is equal or newer', () => {
      expect(isVersionOutdated('1.1.0', '1.1.0')).toBe(false);
      expect(isVersionOutdated('2.0.0', '1.1.0')).toBe(false);
      expect(isVersionOutdated('v1.0.2', '1.0.1')).toBe(false);
    });
  });
  ```

- [ ] **Step 3: Run Vitest unit tests**
  Run: `rtk npm test test/unit/coordinator/utils.test.ts`
  Expected: PASS

- [ ] **Step 4: Commit changes**
  Run:
  ```bash
  git add packages/edge/src/coordinator/utils.ts packages/edge/test/unit/coordinator/utils.test.ts
  git commit -m "refactor: extract and test version checker utility"
  ```

---

### Task 2: Implement and Test `StateManager`

**Files:**
- Create: `packages/edge/src/coordinator/StateManager.ts`
- Test: `packages/edge/test/unit/coordinator/StateManager.test.ts`

**Interfaces:**
- Produces: `StateManager` class with maps (`runners`, `clients`, `jobs`, `pendingChallenges`, `pendingParses`, `pendingParseUrls`, `sseStreams`) and `isPrivateRunner(ws)` helper.

- [ ] **Step 1: Create `packages/edge/src/coordinator/StateManager.ts`**
  ```typescript
  export class StateManager {
    runners = new Set<WebSocket>();
    clients = new Map<string, Set<WebSocket>>();
    jobs = new Map<string, WebSocket>();
    pendingChallenges = new Map<WebSocket, string>();
    pendingParses = new Map<string, (r: Response) => void>();
    pendingParseUrls = new Map<string, string>();
    sseStreams = new Map<string, ReadableStreamDefaultController>();

    constructor(private state: DurableObjectState) {
      this.reconstructState();
    }

    private reconstructState(): void {
      for (const ws of this.state.getWebSockets()) {
        const tags = this.state.getTags(ws);
        if (tags.includes('runner') || tags.includes('runner-pending')) {
          const attachment = ws.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null;
          if (tags.includes('runner') || (attachment && attachment.authenticated)) {
            this.runners.add(ws);
            if (attachment && attachment.activeJobs) {
              for (const runId of attachment.activeJobs) {
                this.jobs.set(runId, ws);
              }
            }
          } else if (attachment && attachment.nonce) {
            this.pendingChallenges.set(ws, attachment.nonce);
          }
        } else if (tags.includes('client')) {
          const runId = tags.find(t => t !== 'client');
          if (runId) {
            if (!this.clients.has(runId)) {
              this.clients.set(runId, new Set());
            }
            this.clients.get(runId)!.add(ws);
          }
        }
      }
    }

    isPrivateRunner(ws: WebSocket): boolean {
      const tags = this.state.getTags(ws);
      return tags.some(tag => 
        tag !== 'runner' && 
        tag !== 'runner-pending' && 
        !tag.startsWith('name:') && 
        !tag.startsWith('version:') &&
        !tag.startsWith('user_id:')
      );
    }
  }
  ```

- [ ] **Step 2: Create unit tests in `packages/edge/test/unit/coordinator/StateManager.test.ts`**
  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import { StateManager } from '../../../src/coordinator/StateManager';

  describe('StateManager', () => {
    it('should reconstruct state from active WebSockets', () => {
      const mockWs = {
        deserializeAttachment: vi.fn().mockReturnValue({ authenticated: true, activeJobs: ['run-1'] })
      } as any;
      const mockState = {
        getWebSockets: vi.fn().mockReturnValue([mockWs]),
        getTags: vi.fn().mockReturnValue(['runner'])
      } as any;

      const manager = new StateManager(mockState);
      expect(manager.runners.has(mockWs)).toBe(true);
      expect(manager.jobs.get('run-1')).toBe(mockWs);
    });

    it('should correctly identify private runner tags', () => {
      const mockWs = {} as any;
      const mockState = {
        getWebSockets: vi.fn().mockReturnValue([]),
        getTags: vi.fn().mockReturnValue(['runner', 'private-company-tag'])
      } as any;

      const manager = new StateManager(mockState);
      expect(manager.isPrivateRunner(mockWs)).toBe(true);
    });
  });
  ```

- [ ] **Step 3: Run Vitest unit tests**
  Run: `rtk npm test test/unit/coordinator/StateManager.test.ts`
  Expected: PASS

- [ ] **Step 4: Commit changes**
  Run:
  ```bash
  git add packages/edge/src/coordinator/StateManager.ts packages/edge/test/unit/coordinator/StateManager.test.ts
  git commit -m "refactor: extract and test StateManager"
  ```

---

### Task 3: Implement and Test `QueueService`

**Files:**
- Create: `packages/edge/src/coordinator/QueueService.ts`
- Test: `packages/edge/test/unit/coordinator/QueueService.test.ts`

**Interfaces:**
- Consumes: `StateManager`
- Produces: `QueueService` with `checkAndDispatchQueuedScans(ws)`

- [ ] **Step 1: Create `packages/edge/src/coordinator/QueueService.ts`**
  ```typescript
  import { Env } from '../env';
  import { StateManager } from './StateManager';
  import { ScansRepository } from '../repositories/scans';
  import { logError } from '../../../common/logging/logger';

  export class QueueService {
    constructor(
      private env: Env,
      private state: DurableObjectState,
      private stateManager: StateManager
    ) {}

    async checkAndDispatchQueuedScans(ws: WebSocket): Promise<void> {
      try {
        const tags = this.state.getTags(ws);
        const runnerPubKey = tags.find(t => 
          t !== 'runner-pending' && 
          t !== 'runner' && 
          !t.startsWith('name:') && 
          !t.startsWith('version:') && 
          !t.startsWith('user_id:')
        ) || null;

        const scansRepo = new ScansRepository(this.env);
        const queuedScans = await scansRepo.getQueuedScans();

        if (!queuedScans || queuedScans.length === 0) {
          return;
        }

        const keys = queuedScans.flatMap(scan => [
          `config:${scan.id}`,
          `user_public_key:${scan.id}`
        ]);
        const storedData = await this.state.storage.get<any>(keys);

        for (const scan of queuedScans) {
          const scanUserPubKey = storedData.get(`user_public_key:${scan.id}`) || scan.userPublicKey || "";
          let config = storedData.get(`config:${scan.id}`);
          
          if (!config && scan.project_id) {
            try {
              const configJson = await scansRepo.getScanConfigByProject(scan.project_id, scan.profile);
              if (configJson) {
                config = JSON.parse(configJson);
              }
            } catch (err) {
              logError(this.env, "Coordinator", "Failed to fetch config from scan_configs", { error: err });
            }
          }
          if (!config) {
            config = {};
          }
          if (!config.base_url) {
            config.base_url = scan.target_url;
          }

          let isCompatible = false;
          if (runnerPubKey) {
            if (scanUserPubKey === runnerPubKey) {
              isCompatible = true;
            }
          } else {
            const disableShared = config.settings?.disable_shared_runners || false;
            if (!scanUserPubKey && !disableShared) {
              isCompatible = true;
            }
          }

          if (isCompatible) {
            const runId = scan.id;
            this.stateManager.jobs.set(runId, ws);
            const attachment = ws.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[] } | null || {};
            const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
            if (!activeJobs.includes(runId)) {
              activeJobs.push(runId);
              ws.serializeAttachment({ ...attachment, activeJobs });
            }

            const dispatchMsg = JSON.stringify({
              type: 'job_dispatch',
              payload: {
                runId,
                config,
                userPublicKey: runnerPubKey || "",
              },
            });

            ws.send(dispatchMsg);

            try {
              await scansRepo.updateScanStatus(runId, 'dispatched');
            } catch (dbErr) {
              logError(this.env, "Coordinator", "Failed to update scan status to dispatched", { error: dbErr });
            }

            await this.state.storage.delete(`config:${runId}`);
            await this.state.storage.delete(`user_public_key:${runId}`);
            break;
          }
        }
      } catch (err) {
        logError(this.env, "Coordinator", "Error in checkAndDispatchQueuedScans", { error: err });
      }
    }
  }
  ```

- [ ] **Step 2: Create unit tests in `packages/edge/test/unit/coordinator/QueueService.test.ts`**
  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { QueueService } from '../../../src/coordinator/QueueService';
  import { StateManager } from '../../../src/coordinator/StateManager';

  vi.mock('../../../src/repositories/scans', () => {
    return {
      ScansRepository: vi.fn().mockImplementation(() => ({
        getQueuedScans: vi.fn().mockResolvedValue([
          { id: 'scan-1', userPublicKey: 'key-123', target_url: 'http://example.com' }
        ]),
        updateScanStatus: vi.fn().mockResolvedValue(true)
      }))
    };
  });

  describe('QueueService', () => {
    let mockState: any;
    let mockEnv: any;
    let mockWs: any;

    beforeEach(() => {
      mockWs = {
        deserializeAttachment: vi.fn().mockReturnValue({}),
        serializeAttachment: vi.fn(),
        send: vi.fn()
      };
      mockState = {
        getWebSockets: vi.fn().mockReturnValue([]),
        getTags: vi.fn().mockReturnValue(['runner', 'key-123']),
        storage: {
          get: vi.fn().mockResolvedValue(new Map()),
          delete: vi.fn().mockResolvedValue(true)
        }
      };
      mockEnv = {};
    });

    it('should dispatch scan matching user public key', async () => {
      const stateManager = new StateManager(mockState);
      const queueService = new QueueService(mockEnv, mockState, stateManager);

      await queueService.checkAndDispatchQueuedScans(mockWs);

      expect(mockWs.send).toHaveBeenCalled();
      expect(stateManager.jobs.get('scan-1')).toBe(mockWs);
    });
  });
  ```

- [ ] **Step 3: Run Vitest unit tests**
  Run: `rtk npm test test/unit/coordinator/QueueService.test.ts`
  Expected: PASS

- [ ] **Step 4: Commit changes**
  Run:
  ```bash
  git add packages/edge/src/coordinator/QueueService.ts packages/edge/test/unit/coordinator/QueueService.test.ts
  git commit -m "refactor: extract and test QueueService"
  ```

---

### Task 4: Implement and Test `WebSocketHandler`

**Files:**
- Create: `packages/edge/src/coordinator/WebSocketHandler.ts`
- Test: `packages/edge/test/unit/coordinator/WebSocketHandler.test.ts`

**Interfaces:**
- Consumes: `StateManager`, `QueueService`
- Produces: `WebSocketHandler` class with message and connection lifecycle handlers.

- [ ] **Step 1: Create `packages/edge/src/coordinator/WebSocketHandler.ts`**
  ```typescript
  import { Env } from '../env';
  import { StateManager } from './StateManager';
  import { QueueService } from './QueueService';
  import { ScansRepository } from '../repositories/scans';
  import { ulid } from 'ulidx';
  import { isVersionOutdated } from './utils';
  import { logError, logWarn } from '../../../common/logging/logger';

  export class WebSocketHandler {
    constructor(
      private env: Env,
      private state: DurableObjectState,
      private stateManager: StateManager,
      private queueService: QueueService
    ) {}

    async handleMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
      const tags = this.state.getTags(ws);
      
      if (tags.includes('runner-pending') && !this.stateManager.runners.has(ws)) {
        try {
          const msg = JSON.parse(message as string);
          if (msg.type === 'challenge_response') {
            const nonce = this.stateManager.pendingChallenges.get(ws);
            const publicKey = tags.find(t => t !== 'runner-pending');
            if (!nonce || !publicKey) {
              ws.close(1008, "Invalid authentication state");
              return;
            }
            
            const signature = msg.signature;
            let isValid = false;
            try {
              const pubKeyBuffer = new Uint8Array(publicKey.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));
              const cryptoKey = await crypto.subtle.importKey(
                "raw",
                pubKeyBuffer,
                { name: "Ed25519" },
                true,
                ["verify"]
              );
              const nonceBuffer = new TextEncoder().encode(nonce);
              const signatureBuffer = new Uint8Array(signature.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16)));
              
              isValid = await crypto.subtle.verify(
                "Ed25519",
                cryptoKey,
                signatureBuffer,
                nonceBuffer
              );
            } catch (err) {
              logError(this.env, "Coordinator", "Runner Ed25519 verify failed", { error: err });
            }
            
            if (isValid) {
              this.stateManager.pendingChallenges.delete(ws);
              this.stateManager.runners.add(ws);
              const attachment = ws.deserializeAttachment() as { connectionId?: string } | null || {};
              ws.serializeAttachment({ ...attachment, authenticated: true });
              ws.send(JSON.stringify({ type: 'auth_ok' }));
              
              const versionTag = tags.find(t => t.startsWith('version:'));
              const version = versionTag ? versionTag.substring(8) : 'v0.0.0';
              const nameTag = tags.find(t => t.startsWith('name:'));
              const name = nameTag ? nameTag.substring(5) : 'Unnamed Runner';
              const coordinatorVersion = this.env.VERSION || '1.0.0';
              if (isVersionOutdated(version, coordinatorVersion)) {
                logWarn(this.env, "Coordinator", `[Runner Connection] Outdated runner agent connected: '${name}' is running version ${version}, but coordinator expects version ${coordinatorVersion}. Please update the agent.`);
              }

              await this.queueService.checkAndDispatchQueuedScans(ws);
            } else {
              ws.send(JSON.stringify({ type: 'auth_failed', error: 'Invalid challenge signature' }));
              ws.close(1008, "Authentication failed");
            }
          }
        } catch (err) {
          logError(this.env, "Coordinator", "Failed to process runner challenge response", { error: err });
          ws.close(1008, "Invalid auth request format");
        }
        return;
      }
      
      if (tags.includes('runner') || this.stateManager.runners.has(ws)) {
        try {
          const msg = JSON.parse(message as string);
          
          if (msg.type === 'parse_result') {
            const resolve = this.stateManager.pendingParses.get(msg.reqId);
            const urlStr = this.stateManager.pendingParseUrls.get(msg.reqId);
            this.stateManager.pendingParseUrls.delete(msg.reqId);
            
            if (resolve) {
              this.stateManager.pendingParses.delete(msg.reqId);
              
              if (msg.payload && !msg.payload.error && urlStr && urlStr !== 'rawSpec') {
                const scansRepo = new ScansRepository(this.env);
                const storage = this.env.STORAGE;
                
                (async () => {
                  try {
                    const basePath = msg.payload.basePath || '';
                    const endpoints = msg.payload.endpoints || [];
                    const rawSpec = msg.payload.rawSpec || '';
                    const endpointsJson = JSON.stringify(endpoints);
                    
                    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpointsJson));
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const endpointsHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    
                    const existing = await scansRepo.getCachedSwaggerDetails(urlStr);
                      
                    let endpointsR2Key = existing?.endpoints_r2_key;
                    let rawSpecR2Key = existing?.raw_spec_r2_key;
                    let shouldWriteR2 = false;
                    
                    if (!existing) {
                      endpointsR2Key = `specs/parsed/${ulid()}.json`;
                      rawSpecR2Key = `specs/raw/${ulid()}.json`;
                      shouldWriteR2 = true;
                    } else if (existing.endpoints_hash !== endpointsHash) {
                      shouldWriteR2 = true;
                    }
                    
                    if (shouldWriteR2) {
                      await storage.put(endpointsR2Key!, endpointsJson);
                      if (rawSpec) {
                        await storage.put(rawSpecR2Key!, rawSpec);
                      }
                    }
                    
                    await scansRepo.upsertSwaggerCache(urlStr, basePath, endpointsHash, endpointsR2Key, rawSpecR2Key);
                  } catch (cacheErr) {
                    logError(this.env, "Coordinator", "Failed to write swagger cache in background", { error: cacheErr });
                  }
                })();
              }

              const clientPayload = { ...msg.payload };
              if (clientPayload.rawSpec !== undefined) {
                delete clientPayload.rawSpec;
              }
              if (clientPayload.basePath !== undefined) {
                if (typeof clientPayload.basePath !== 'string') {
                  throw new TypeError('clientPayload.basePath must be a string');
                }
                if (clientPayload.basePath.includes("bbad.secmy.app")) {
                  const isLocal = this.env.JWT_SECRET === 'test-secret';
                  if (isLocal) {
                    clientPayload.basePath = clientPayload.basePath.replace(/(https?:\/\/)?bbad\.secmy\.app/, "http://127.0.0.1:8788");
                  }
                }
              }
              
              resolve(new Response(JSON.stringify(clientPayload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
            }
          }
          if (msg.type === 'event' || msg.type === 'error') {
            const runId = msg.runId;
            
            this.state.waitUntil(
              this.env.FINDINGS_QUEUE.send({
                scanId: runId,
                type: msg.type,
                payload: msg.payload
              }).catch(qErr => {
                logError(this.env, "Coordinator", "Failed to send to FINDINGS_QUEUE", { error: qErr });
              })
            );

            const clientSet = this.stateManager.clients.get(runId);
            if (clientSet) {
              const outMsg = JSON.stringify(msg.payload);
              for (const client of clientSet) {
                try {
                  client.send(outMsg);
                } catch (e) {
                  // client closed
                }
              }
            }

            let shouldCleanup = false;
            if (msg.type === 'error') {
              shouldCleanup = true;
            } else if (msg.type === 'event' && msg.payload && (msg.payload.type === 'complete' || msg.payload.type === 'error')) {
              shouldCleanup = true;
            }

            if (shouldCleanup && runId) {
              this.stateManager.jobs.delete(runId);
              const attachment = ws.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[] } | null || {};
              const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
              const index = activeJobs.indexOf(runId);
              if (index > -1) {
                activeJobs.splice(index, 1);
                ws.serializeAttachment({ ...attachment, activeJobs });
              }
            }
          }
        } catch (e) {
          logError(this.env, "Coordinator", "Failed to parse runner message", { error: e });
        }
      }
    }

    async handleClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
      const tags = this.state.getTags(ws);
      if (tags.includes('runner') || tags.includes('runner-pending')) {
        this.stateManager.runners.delete(ws);
        this.stateManager.pendingChallenges.delete(ws);
        for (const [runId, r] of this.stateManager.jobs.entries()) {
          if (r === ws) {
            this.stateManager.jobs.delete(runId);
          }
        }
      } else if (tags.includes('client')) {
        const runId = tags.find(t => t !== 'client');
        if (runId && this.stateManager.clients.has(runId)) {
          this.stateManager.clients.get(runId)!.delete(ws);
          if (this.stateManager.clients.get(runId)!.size === 0) {
            this.stateManager.clients.delete(runId);
          }
        }
      }
    }

    async handleError(ws: WebSocket, error: any): Promise<void> {
      await this.handleClose(ws, 1011, "Error", false);
    }
  }
  ```

- [ ] **Step 2: Create unit tests in `packages/edge/test/unit/coordinator/WebSocketHandler.test.ts`**
  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { WebSocketHandler } from '../../../src/coordinator/WebSocketHandler';
  import { StateManager } from '../../../src/coordinator/StateManager';
  import { QueueService } from '../../../src/coordinator/QueueService';

  describe('WebSocketHandler', () => {
    let mockState: any;
    let mockEnv: any;
    let mockWs: any;

    beforeEach(() => {
      mockWs = {
        deserializeAttachment: vi.fn().mockReturnValue({}),
        serializeAttachment: vi.fn(),
        send: vi.fn(),
        close: vi.fn()
      };
      mockState = {
        getWebSockets: vi.fn().mockReturnValue([]),
        getTags: vi.fn().mockReturnValue(['client', 'run-123']),
        waitUntil: vi.fn()
      };
      mockEnv = {
        FINDINGS_QUEUE: {
          send: vi.fn().mockResolvedValue(true)
        }
      };
    });

    it('should correctly handle WebSocket close for clients', async () => {
      const stateManager = new StateManager(mockState);
      const queueService = new QueueService(mockEnv, mockState, stateManager);
      const handler = new WebSocketHandler(mockEnv, mockState, stateManager, queueService);

      stateManager.clients.set('run-123', new Set([mockWs]));
      await handler.handleClose(mockWs, 1000, 'Normal', true);

      expect(stateManager.clients.has('run-123')).toBe(false);
    });
  });
  ```

- [ ] **Step 3: Run Vitest unit tests**
  Run: `rtk npm test test/unit/coordinator/WebSocketHandler.test.ts`
  Expected: PASS

- [ ] **Step 4: Commit changes**
  Run:
  ```bash
  git add packages/edge/src/coordinator/WebSocketHandler.ts packages/edge/test/unit/coordinator/WebSocketHandler.test.ts
  git commit -m "refactor: extract and test WebSocketHandler"
  ```

---

### Task 5: Implement and Test `RequestHandler`

**Files:**
- Create: `packages/edge/src/coordinator/RequestHandler.ts`
- Test: `packages/edge/test/unit/coordinator/RequestHandler.test.ts`

**Interfaces:**
- Consumes: `StateManager`, `QueueService`
- Produces: `RequestHandler` handling routing to internal endpoint handlers.

- [ ] **Step 1: Create `packages/edge/src/coordinator/RequestHandler.ts`**
  ```typescript
  import { Env } from '../env';
  import { StateManager } from './StateManager';
  import { QueueService } from './QueueService';
  import { ScansRepository } from '../repositories/scans';
  import { ulid } from 'ulidx';
  import { logError, logWarn } from '../../../common/logging/logger';
  import { isVersionOutdated } from './utils';

  export class RequestHandler {
    constructor(
      private env: Env,
      private state: DurableObjectState,
      private stateManager: StateManager,
      private queueService: QueueService
    ) {}

    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === '/sse') {
        const connectionId = url.searchParams.get('connectionId');
        if (!connectionId) {
          return new Response('Missing connectionId', { status: 400 });
        }

        const origin = decodeURIComponent(url.searchParams.get('origin') || '');
        const stream = new ReadableStream({
          start: (controller) => {
            this.stateManager.sseStreams.set(connectionId, controller);
            const endpointUrl = `${origin}/api/mcp/message?connectionId=${connectionId}`;
            const initEvent = `event: endpoint\ndata: ${endpointUrl}\n\n`;
            controller.enqueue(new TextEncoder().encode(initEvent));
          },
          cancel: () => {
            this.stateManager.sseStreams.delete(connectionId);
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

      if (url.pathname === '/sse-send') {
        const connectionId = url.searchParams.get('connectionId');
        if (!connectionId) {
          return new Response('Missing connectionId', { status: 400 });
        }

        const controller = this.stateManager.sseStreams.get(connectionId);
        if (!controller) {
          return new Response('Connection not found', { status: 404 });
        }

        try {
          const body = await request.text();
          controller.enqueue(new TextEncoder().encode(`event: message\ndata: ${body}\n\n`));
        } catch (err) {
          this.stateManager.sseStreams.delete(connectionId);
          return new Response('Connection closed', { status: 410 });
        }
        return new Response('Sent', { status: 200 });
      }

      if (url.pathname === '/revoke-user') {
        const userId = url.searchParams.get('userId');
        if (!userId) {
          return new Response('Missing userId', { status: 400 });
        }

        const userIdTag = `user_id:${userId}`;
        let disconnectedCount = 0;

        for (const ws of this.state.getWebSockets()) {
          const tags = this.state.getTags(ws);
          if (tags.includes(userIdTag)) {
            try {
              ws.close(1008, "User account deleted");
            } catch {
              // ignore
            }
            this.stateManager.runners.delete(ws);
            disconnectedCount++;
          }
        }

        return new Response(JSON.stringify({ disconnectedCount }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/dispatch') {
        let payload: any = null;
        try {
          payload = await request.json();
        } catch (err) {
          return new Response('Invalid JSON payload', { status: 400 });
        }
        if (!payload) {
          return new Response('Missing payload', { status: 400 });
        }

        await this.state.storage.put(`config:${payload.runId}`, payload.config || {});
        await this.state.storage.put(`user_public_key:${payload.runId}`, payload.userPublicKey || "");

        const activeRunners = Array.from(this.stateManager.runners);
        if (activeRunners.length === 0) {
          return new Response('No runners available', { status: 503 });
        }
        
        const dispatchMsg = JSON.stringify({
          type: 'job_dispatch',
          payload,
        });

        let runner = null;
        if (payload.userPublicKey) {
          runner = activeRunners.find(r => {
            const tags = this.state.getTags(r);
            return tags.includes(payload.userPublicKey);
          });
        }
        if (!runner && !payload?.config?.settings?.disable_shared_runners) {
          runner = activeRunners.find(r => !this.stateManager.isPrivateRunner(r)) || null;
        }

        if (runner) {
          this.stateManager.jobs.set(payload.runId, runner);
          const attachment = runner.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null || {};
          const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
          if (!activeJobs.includes(payload.runId)) {
            activeJobs.push(payload.runId);
            runner.serializeAttachment({ ...attachment, activeJobs });
          }
          try {
            runner.send(dispatchMsg);
            await this.state.storage.delete(`config:${payload.runId}`);
            await this.state.storage.delete(`user_public_key:${payload.runId}`);
            return new Response('Dispatched', { status: 200 });
          } catch (err) {
            this.stateManager.runners.delete(runner);
            this.stateManager.jobs.delete(payload.runId);
            const index = activeJobs.indexOf(payload.runId);
            if (index > -1) {
              activeJobs.splice(index, 1);
              runner.serializeAttachment({ ...attachment, activeJobs });
            }
            return new Response('Failed to send dispatch command to runner', { status: 500 });
          }
        }
        return new Response('No runner could accept job', { status: 503 });
      }

      if (url.pathname === '/command') {
        let payload: any = null;
        try {
          payload = await request.json();
        } catch (err) {
          return new Response('Invalid JSON payload', { status: 400 });
        }
        if (!payload || !payload.runId) {
          return new Response('Missing runId', { status: 400 });
        }

        const runner = this.stateManager.jobs.get(payload.runId);
        if (runner) {
          runner.send(JSON.stringify({
            type: 'job_command',
            payload,
          }));
          return new Response('Command sent', { status: 200 });
        }
        return new Response('Runner not found for job', { status: 404 });
      }

      if (url.pathname === '/parse') {
        let body: { url?: string; rawSpec?: string; forceRebuild?: boolean; userPublicKey?: string } | null = null;
        try {
          const bodyText = await request.text();
          body = JSON.parse(bodyText);
        } catch (err) {
          return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        if (body && body.url !== undefined) {
          if (typeof body.url !== 'string') {
            throw new TypeError('body.url must be a string');
          }
          if (body.url.includes("bbad.secmy.app")) {
            const isLocal = this.env.JWT_SECRET === 'test-secret';
            if (isLocal) {
              body.url = body.url.replace(/(https?:\/\/)?bbad\.secmy\.app/, "http://127.0.0.1:8788");
            }
          }
        }
        if (!body || (!body.url && !body.rawSpec)) {
          return new Response(JSON.stringify({ error: "Missing required parameter: url or rawSpec" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        if (body.url && !body.forceRebuild) {
          try {
            const scansRepo = new ScansRepository(this.env);
            const cached = await scansRepo.getCachedSwagger(body.url);
              
            if (cached && cached.endpoints_r2_key) {
              const r2Object = await this.env.STORAGE.get(cached.endpoints_r2_key);
              if (r2Object) {
                const endpointsText = await r2Object.text();
                let basePath = cached.base_path || '';
                if (basePath.includes("bbad.secmy.app")) {
                  const isLocal = this.env.JWT_SECRET === 'test-secret';
                  if (isLocal) {
                    basePath = basePath.replace(/(https?:\/\/)?bbad\.secmy\.app/, "http://127.0.0.1:8788");
                  }
                }
                return new Response(JSON.stringify({
                  basePath: basePath,
                  endpoints: JSON.parse(endpointsText),
                  cachedAt: cached.fetched_at,
                  fromCache: true
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
              }
            }
          } catch (dbErr) {
            logError(this.env, "Coordinator", "Failed to read swagger cache from DB/R2", { error: dbErr });
          }
        }

        const activeRunners = Array.from(this.stateManager.runners);
        if (activeRunners.length === 0) return new Response(JSON.stringify({ error: "No active runners connected to Coordinator" }), { status: 503 });
        const reqId = ulid();
        this.stateManager.pendingParseUrls.set(reqId, body.url || 'rawSpec');
        
        let runnerWs = null;
        if (body.userPublicKey) {
          runnerWs = activeRunners.find(r => {
            const tags = this.state.getTags(r);
            return tags.includes(body.userPublicKey!);
          });
        }
        if (!runnerWs) {
          runnerWs = activeRunners.find(r => !this.stateManager.isPrivateRunner(r)) || null;
        }

        if (!runnerWs) {
          this.stateManager.pendingParseUrls.delete(reqId);
          return new Response(JSON.stringify({ error: "No compatible runner connected to Coordinator" }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }

        try {
          runnerWs.send(JSON.stringify({
            type: 'parse_request',
            reqId,
            payload: {
              url: body.url || '',
              rawSpec: body.rawSpec || ''
            }
          }));
        } catch (err) {
          this.stateManager.pendingParseUrls.delete(reqId);
          return new Response(JSON.stringify({ error: "Failed to send parse request to runner" }), { status: 500 });
        }
        
        return new Promise<Response>((resolve) => {
          this.stateManager.pendingParses.set(reqId, resolve);
          setTimeout(() => {
            if (this.stateManager.pendingParses.has(reqId)) {
              this.stateManager.pendingParses.delete(reqId);
              this.stateManager.pendingParseUrls.delete(reqId);
              resolve(new Response(JSON.stringify({ error: "Parse timeout from Go runner" }), { status: 504 }));
            }
          }, 30000);
        });
      }

      if (url.pathname === '/start-run') {
        const runId = url.searchParams.get('runId')!;
        const configText = await request.text();
        const activeRunners = Array.from(this.stateManager.runners);
        if (activeRunners.length === 0) return new Response("No runners available", { status: 503 });
        
        const runnerWs = activeRunners.find(r => !this.stateManager.isPrivateRunner(r));
        if (!runnerWs) {
          return new Response("No shared runners available", { status: 503 });
        }
        this.stateManager.jobs.set(runId, runnerWs);
        const attachment = runnerWs.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null || {};
        const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
        if (!activeJobs.includes(runId)) {
          activeJobs.push(runId);
          runnerWs.serializeAttachment({ ...attachment, activeJobs });
        }
        const parsedConfig = JSON.parse(configText).config;
        try {
          runnerWs.send(JSON.stringify({ type: 'start', runId, config: parsedConfig }));
        } catch (err) {
          this.stateManager.runners.delete(runnerWs);
          this.stateManager.jobs.delete(runId);
          const updatedAttachment = runnerWs.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null || {};
          const updatedJobs = updatedAttachment.activeJobs ? [...updatedAttachment.activeJobs] : [];
          const index = updatedJobs.indexOf(runId);
          if (index > -1) {
            updatedJobs.splice(index, 1);
            runnerWs.serializeAttachment({ ...updatedAttachment, activeJobs: updatedJobs });
          }
          return new Response("Failed to send start command to runner", { status: 500 });
        }
        return new Response("ok");
      }

      if (url.pathname === '/control-run') {
        const runId = url.searchParams.get('runId')!;
        const action = url.searchParams.get('action')!;
        const runnerWs = this.stateManager.jobs.get(runId);
        if (runnerWs) {
          try {
            runnerWs.send(JSON.stringify({ type: action, runId }));
          } catch (err) {
            // ignore
          }
        }
        return new Response("ok");
      }

      if (url.pathname === '/runners') {
        const runnerList = [];
        for (const ws of this.stateManager.runners) {
          const tags = this.state.getTags(ws);
          const isPending = tags.includes('runner-pending');
          const pubKey = tags.find(t => 
            t !== 'runner-pending' && 
            t !== 'runner' && 
            !t.startsWith('name:') && 
            !t.startsWith('version:') && 
            !t.startsWith('user_id:')
          ) || null;
          const nameTag = tags.find(t => t.startsWith('name:'));
          const name = nameTag ? nameTag.substring(5) : 'Unnamed Runner';
          const versionTag = tags.find(t => t.startsWith('version:'));
          const version = versionTag ? versionTag.substring(8) : 'v0.0.0';
          
          let connectionId = null;
          let activeJobs: string[] = [];
          try {
            const attachment = ws.deserializeAttachment() as { connectionId?: string; activeJobs?: string[] } | null;
            if (attachment) {
              if (attachment.connectionId) {
                connectionId = attachment.connectionId;
              }
              if (attachment.activeJobs) {
                activeJobs = attachment.activeJobs;
              }
            }
          } catch {}

          runnerList.push({
            connectionId,
            name,
            publicKey: pubKey,
            status: isPending ? 'authenticating' : 'connected',
            isShared: !pubKey,
            version,
            activeJobs,
          });
        }
        return new Response(JSON.stringify({ runners: runnerList }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/runners/restart') {
        const connectionId = url.searchParams.get('connectionId');
        const userPublicKey = url.searchParams.get('userPublicKey');
        if (!connectionId) {
          return new Response('Missing connectionId', { status: 400 });
        }

        let runnerWs = null;
        for (const ws of this.stateManager.runners) {
          try {
            const attachment = ws.deserializeAttachment() as { connectionId?: string } | null;
            if (attachment && attachment.connectionId === connectionId) {
              runnerWs = ws;
              break;
            }
          } catch {}
        }

        if (!runnerWs) {
          return new Response('Runner not found', { status: 404 });
        }

        const tags = this.state.getTags(runnerWs);
        const pubKey = tags.find(t => 
          t !== 'runner-pending' && 
          t !== 'runner' && 
          !t.startsWith('name:') && 
          !t.startsWith('version:') && 
          !t.startsWith('user_id:')
        ) || null;

        if (!pubKey) {
          return new Response('Forbidden: Shared runners cannot be restarted', { status: 403 });
        }

        if (pubKey !== userPublicKey) {
          return new Response('Forbidden: You do not own this runner', { status: 403 });
        }

        try {
          runnerWs.send(JSON.stringify({ type: 'agent_restart' }));
          return new Response('Restart command sent', { status: 200 });
        } catch (err) {
          return new Response('Failed to send restart command', { status: 500 });
        }
      }

      if (url.pathname === '/connect-runner') {
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);
        
        const publicKey = url.searchParams.get('public_key');
        const userId = url.searchParams.get('user_id') || '';
        const name = url.searchParams.get('name') || 'Unnamed Runner';
        const version = url.searchParams.get('version') || 'v1.0.0';
        const nameTag = `name:${name}`;
        const versionTag = `version:${version}`;
        const userIdTag = userId ? `user_id:${userId}` : '';
        
        if (publicKey) {
          const tags = ["runner-pending", publicKey, nameTag, versionTag];
          if (userIdTag) tags.push(userIdTag);
          this.state.acceptWebSocket(server, tags);
          
          const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
            
          this.stateManager.pendingChallenges.set(server, nonce);
          const connectionId = ulid();
          server.serializeAttachment({ authenticated: false, nonce, connectionId });
          
          setTimeout(() => {
            try {
              server.send(JSON.stringify({ type: 'challenge', nonce }));
            } catch { /* ignored */ }
          }, 50);
          
          setTimeout(() => {
            try {
              if (!this.stateManager.runners.has(server)) {
                server.close(1008, "Authentication timeout");
              }
            } catch { /* ignored */ }
          }, 5000);
        } else {
          const tags = ["runner", nameTag, versionTag];
          if (userIdTag) tags.push(userIdTag);
          this.state.acceptWebSocket(server, tags);
          const connectionId = ulid();
          server.serializeAttachment({ authenticated: true, connectionId });
          this.stateManager.runners.add(server);

          const coordinatorVersion = this.env.VERSION || '1.0.0';
          if (isVersionOutdated(version, coordinatorVersion)) {
            logWarn(this.env, "Coordinator", `[Runner Connection] Outdated runner agent connected: '${name}' (Shared) is running version ${version}, but coordinator expects version ${coordinatorVersion}. Please update the agent.`);
          }

          await this.queueService.checkAndDispatchQueuedScans(server);
        }

        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }

      if (url.pathname === '/connect-client') {
        const runId = url.searchParams.get('runId');
        if (!runId) return new Response('Missing runId', { status: 400 });

        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);
        
        this.state.acceptWebSocket(server, ["client", runId]);
        
        if (!this.stateManager.clients.has(runId)) {
          this.stateManager.clients.set(runId, new Set());
        }
        this.stateManager.clients.get(runId)!.add(server);

        return new Response(null, {
          status: 101,
          webSocket: client,
        });
      }

      return new Response('Not found', { status: 404 });
    }
  }
  ```

- [ ] **Step 2: Create unit tests in `packages/edge/test/unit/coordinator/RequestHandler.test.ts`**
  ```typescript
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { RequestHandler } from '../../../src/coordinator/RequestHandler';
  import { StateManager } from '../../../src/coordinator/StateManager';
  import { QueueService } from '../../../src/coordinator/QueueService';

  describe('RequestHandler', () => {
    let mockState: any;
    let mockEnv: any;

    beforeEach(() => {
      mockState = {
        getWebSockets: vi.fn().mockReturnValue([]),
        getTags: vi.fn().mockReturnValue([])
      };
      mockEnv = {};
    });

    it('returns 404 for unknown endpoints', async () => {
      const stateManager = new StateManager(mockState);
      const queueService = new QueueService(mockEnv, mockState, stateManager);
      const handler = new RequestHandler(mockEnv, mockState, stateManager, queueService);

      const res = await handler.handle(new Request('http://localhost/unknown'));
      expect(res.status).toBe(404);
    });
  });
  ```

- [ ] **Step 3: Run Vitest unit tests**
  Run: `rtk npm test test/unit/coordinator/RequestHandler.test.ts`
  Expected: PASS

- [ ] **Step 4: Commit changes**
  Run:
  ```bash
  git add packages/edge/src/coordinator/RequestHandler.ts packages/edge/test/unit/coordinator/RequestHandler.test.ts
  git commit -m "refactor: extract and test RequestHandler"
  ```

---

### Task 6: Refactor Durable Object `RunnerCoordinator` entry point

**Files:**
- Modify: `packages/edge/src/Coordinator.ts`

**Interfaces:**
- Consumes: All newly created sub-handlers.
- Produces: Clean, delegation-only `RunnerCoordinator` DO class.

- [ ] **Step 1: Refactor `packages/edge/src/Coordinator.ts`**
  Replace contents of [Coordinator.ts](file:///Users/alex/src/swazz/packages/edge/src/Coordinator.ts) completely with:
  ```typescript
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
  ```

- [ ] **Step 2: Run all packages/edge tests**
  Run: `rtk npm test` in `packages/edge/`
  Expected: PASS (all 450+ unit and integration tests passing successfully)

- [ ] **Step 3: Commit changes**
  Run:
  ```bash
  git add packages/edge/src/Coordinator.ts
  git commit -m "refactor: simplify RunnerCoordinator to delegate to state, request, and websocket handlers"
  ```
