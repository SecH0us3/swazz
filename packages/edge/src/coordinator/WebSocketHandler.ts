import { Env } from '../env';
import { StateManager } from './StateManager';
import { QueueService } from './QueueService';
import { ScansRepository } from '../repositories/scans';
import { ulid } from 'ulidx';
import { isVersionOutdated, getPublicKeyFromTags, getRunIdFromTags } from './utils';
import { logError, logWarn } from '../../../common/logging/logger';

export class WebSocketHandler {
  constructor(
    private env: Env,
    private state: DurableObjectState,
    private stateManager: StateManager,
    private queueService: QueueService
  ) {}

  async handleMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let messageStr: string;
    if (typeof message === 'string') {
      messageStr = message;
    } else if (message instanceof ArrayBuffer) {
      messageStr = new TextDecoder().decode(message);
    } else {
      return;
    }

    const tags = this.state.getTags(ws);
    
    if (tags.includes('runner-pending') && !this.stateManager.runners.has(ws)) {
      try {
        const msg = JSON.parse(messageStr);
        if (msg.type === 'challenge_response') {
          const nonce = this.stateManager.pendingChallenges.get(ws);
          const publicKey = getPublicKeyFromTags(tags);
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
        const msg = JSON.parse(messageStr);
        
        if (msg.type === 'parse_result') {
          const resolve = this.stateManager.pendingParses.get(msg.reqId);
          const urlStr = this.stateManager.pendingParseUrls.get(msg.reqId);
          this.stateManager.pendingParseUrls.delete(msg.reqId);
          
          if (resolve) {
            this.stateManager.pendingParses.delete(msg.reqId);
            
            if (msg.payload && !msg.payload.error && urlStr && urlStr !== 'rawSpec') {
              const scansRepo = new ScansRepository(this.env);
              const storage = this.env.STORAGE;
              
              this.state.waitUntil((async () => {
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
              })());
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
      const runId = getRunIdFromTags(tags);
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
