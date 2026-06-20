import { Env } from './env';
import { ulid } from 'ulidx';

export class RunnerCoordinator {
  state: DurableObjectState;
  env: Env;
  runners: Set<WebSocket>;
  clients: Map<string, Set<WebSocket>>; // runId -> client WS
  jobs: Map<string, WebSocket>; // runId -> runner WS
  pendingChallenges?: Map<WebSocket, string>; // runner WS -> challenge nonce
  pendingParses: Map<string, (r: Response) => void>;
  pendingParseUrls: Map<string, string>; // reqId -> url

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.runners = new Set();
    this.clients = new Map();
    this.jobs = new Map();
    this.pendingParses = new Map();
    this.pendingParseUrls = new Map();

    // Reconstruct in-memory maps from active WebSockets after waking up/initializing
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
          if (!this.pendingChallenges) {
            this.pendingChallenges = new Map();
          }
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
    return tags.some(tag => tag !== 'runner' && tag !== 'runner-pending' && !tag.startsWith('name:') && !tag.startsWith('version:'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/dispatch') {
      const activeRunners = Array.from(this.runners);
      if (activeRunners.length === 0) {
        return new Response('No runners available', { status: 503 });
      }
      
      let payload: any = null;
      try {
        payload = await request.json();
      } catch (err) {
        return new Response('Invalid JSON payload', { status: 400 });
      }
      if (!payload) {
        return new Response('Missing payload', { status: 400 });
      }

      const dispatchMsg = JSON.stringify({
        type: 'job_dispatch',
        payload,
      });

      // Prioritize picking the runner matching the user's public key
      let runner = null;
      if (payload.userPublicKey) {
        runner = activeRunners.find(r => {
          const tags = this.state.getTags(r);
          return tags.includes(payload.userPublicKey);
        });
      }
      // Fallback only to any SHARED (non-private) runner
      if (!runner && !payload?.config?.settings?.disable_shared_runners) {
        runner = activeRunners.find(r => !this.isPrivateRunner(r)) || null;
      }

      if (runner) {
        this.jobs.set(payload.runId, runner);
        const attachment = runner.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null || {};
        const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
        if (!activeJobs.includes(payload.runId)) {
          activeJobs.push(payload.runId);
          runner.serializeAttachment({ ...attachment, activeJobs });
        }
        try {
          runner.send(dispatchMsg);
          return new Response('Dispatched', { status: 200 });
        } catch (err) {
          this.runners.delete(runner);
          this.jobs.delete(payload.runId);
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

      const runner = this.jobs.get(payload.runId);
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
      let body: { url: string; forceRebuild?: boolean; userPublicKey?: string } | null = null;
      try {
        const bodyText = await request.text();
        body = JSON.parse(bodyText);
      } catch (err) {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (!body || !body.url) {
        return new Response(JSON.stringify({ error: "Missing required parameter: url" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      
      if (!body.forceRebuild) {
        try {
          const cached = await this.env.DB.prepare('SELECT base_path, endpoints_r2_key, fetched_at FROM swagger_cache WHERE url = ?')
            .bind(body.url)
            .first() as { base_path: string; endpoints_r2_key: string; fetched_at: string } | null;
            
          if (cached && cached.endpoints_r2_key) {
            const r2Object = await this.env.STORAGE.get(cached.endpoints_r2_key);
            if (r2Object) {
              const endpointsText = await r2Object.text();
              return new Response(JSON.stringify({
                basePath: cached.base_path,
                endpoints: JSON.parse(endpointsText),
                cachedAt: cached.fetched_at,
                fromCache: true
              }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
          }
        } catch (dbErr) {
          console.error("Failed to read swagger cache from DB/R2:", dbErr);
        }
      }

      const activeRunners = Array.from(this.runners);
      if (activeRunners.length === 0) return new Response(JSON.stringify({ error: "No active runners connected to Coordinator" }), { status: 503 });
      const reqId = ulid();
      this.pendingParseUrls.set(reqId, body.url);
      
      // Prioritize picking the runner matching the user's public key
      let runnerWs = null;
      if (body.userPublicKey) {
        runnerWs = activeRunners.find(r => {
          const tags = this.state.getTags(r);
          return tags.includes(body.userPublicKey!);
        });
      }
      // Fallback only to any SHARED (non-private) runner
      if (!runnerWs) {
        runnerWs = activeRunners.find(r => !this.isPrivateRunner(r)) || null;
      }

      try {
        runnerWs.send(JSON.stringify({ type: 'parse_request', reqId, payload: { url: body.url } }));
      } catch (err) {
        this.pendingParseUrls.delete(reqId);
        return new Response(JSON.stringify({ error: "Failed to send parse request to runner" }), { status: 500 });
      }
      
      return new Promise<Response>((resolve) => {
        this.pendingParses.set(reqId, resolve);
        setTimeout(() => {
          if (this.pendingParses.has(reqId)) {
            this.pendingParses.delete(reqId);
            this.pendingParseUrls.delete(reqId);
            resolve(new Response(JSON.stringify({ error: "Parse timeout from Go runner" }), { status: 504 }));
          }
        }, 30000);
      });
    }

    if (url.pathname === '/start-run') {
      const runId = url.searchParams.get('runId')!;
      const configText = await request.text();
      const activeRunners = Array.from(this.runners);
      if (activeRunners.length === 0) return new Response("No runners available", { status: 503 });
      
      // Fallback only to any SHARED (non-private) runner
      const runnerWs = activeRunners.find(r => !this.isPrivateRunner(r));
      if (!runnerWs) {
        return new Response("No shared runners available", { status: 503 });
      }
      this.jobs.set(runId, runnerWs);
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
        this.runners.delete(runnerWs);
        this.jobs.delete(runId);
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
      const runnerWs = this.jobs.get(runId);
      if (runnerWs) {
        try {
          runnerWs.send(JSON.stringify({ type: action, runId }));
        } catch (err) {
          // ignore or log
        }
      }
      return new Response("ok");
    }

    if (url.pathname === '/runners') {
      const runnerList = [];
      for (const ws of this.runners) {
        const tags = this.state.getTags(ws);
        const isPending = tags.includes('runner-pending');
        const pubKey = tags.find(t => t !== 'runner-pending' && t !== 'runner' && !t.startsWith('name:') && !t.startsWith('version:')) || null;
        const nameTag = tags.find(t => t.startsWith('name:'));
        const name = nameTag ? nameTag.substring(5) : 'Unnamed Runner';
        const versionTag = tags.find(t => t.startsWith('version:'));
        const version = versionTag ? versionTag.substring(8) : 'v0.0.0';

        runnerList.push({
          name,
          publicKey: pubKey,
          status: isPending ? 'authenticating' : 'connected',
          isShared: !pubKey,
          version,
        });
      }
      return new Response(JSON.stringify({ runners: runnerList }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/connect-runner') {
      const webSocketPair = new WebSocketPair();
      const [client, server] = Object.values(webSocketPair);
      
      const publicKey = url.searchParams.get('public_key');
      const name = url.searchParams.get('name') || 'Unnamed Runner';
      const version = url.searchParams.get('version') || 'v1.0.0';
      const nameTag = `name:${name}`;
      const versionTag = `version:${version}`;
      
      if (publicKey) {
        this.state.acceptWebSocket(server, ["runner-pending", publicKey, nameTag, versionTag]);
        
        // Generate random 32-byte hex challenge nonce
        const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
          
        if (!this.pendingChallenges) {
          this.pendingChallenges = new Map();
        }
        this.pendingChallenges.set(server, nonce);
        server.serializeAttachment({ authenticated: false, nonce });
        
        // Send challenge after a tiny delay to ensure client is ready to receive messages
        setTimeout(() => {
          try {
            server.send(JSON.stringify({ type: 'challenge', nonce }));
          } catch { /* ignored */ }
        }, 50);
        
        // Timeout auth after 5 seconds
        setTimeout(() => {
          try {
            if (!this.runners.has(server)) {
              server.close(1008, "Authentication timeout");
            }
          } catch { /* ignored */ }
        }, 5000);
      } else {
        this.state.acceptWebSocket(server, ["runner", nameTag, versionTag]);
        server.serializeAttachment({ authenticated: true });
        this.runners.add(server);
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
      
      if (!this.clients.has(runId)) {
        this.clients.set(runId, new Set());
      }
      this.clients.get(runId)!.add(server);

      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const tags = this.state.getTags(ws);
    
    if (tags.includes('runner-pending') && !this.runners.has(ws)) {
      try {
        const msg = JSON.parse(message as string);
        if (msg.type === 'challenge_response') {
          const nonce = this.pendingChallenges?.get(ws);
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
            console.error("Runner Ed25519 verify failed:", err);
          }
          
          if (isValid) {
            this.pendingChallenges?.delete(ws);
            this.runners.add(ws);
            ws.serializeAttachment({ authenticated: true });
            ws.send(JSON.stringify({ type: 'auth_ok' }));
          } else {
            ws.send(JSON.stringify({ type: 'auth_failed', error: 'Invalid challenge signature' }));
            ws.close(1008, "Authentication failed");
          }
        }
      } catch (err) {
        console.error("Failed to process runner challenge response:", err);
        ws.close(1008, "Invalid auth request format");
      }
      return;
    }
    
    if (tags.includes('runner') || this.runners.has(ws)) {
      try {
        const msg = JSON.parse(message as string);
        
        if (msg.type === 'parse_result') {
          const resolve = this.pendingParses.get(msg.reqId);
          const urlStr = this.pendingParseUrls.get(msg.reqId);
          this.pendingParseUrls.delete(msg.reqId);
          
          if (resolve) {
            this.pendingParses.delete(msg.reqId);
            
            // Background write to DB/R2
            if (msg.payload && !msg.payload.error && urlStr) {
              const db = this.env.DB;
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
                  
                  const existing = await db.prepare('SELECT endpoints_hash, endpoints_r2_key, raw_spec_r2_key FROM swagger_cache WHERE url = ?')
                    .bind(urlStr)
                    .first() as { endpoints_hash: string; endpoints_r2_key: string; raw_spec_r2_key: string } | null;
                    
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
                  
                  await db.prepare('INSERT OR REPLACE INTO swagger_cache (url, base_path, endpoints_hash, endpoints_r2_key, raw_spec_r2_key, fetched_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
                    .bind(urlStr, basePath, endpointsHash, endpointsR2Key, rawSpecR2Key)
                    .run();
                } catch (cacheErr) {
                  console.error("Failed to write swagger cache in background:", cacheErr);
                }
              })();
            }

            const clientPayload = { ...msg.payload };
            if (clientPayload.rawSpec !== undefined) {
              delete clientPayload.rawSpec;
            }
            
            resolve(new Response(JSON.stringify(clientPayload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
          }
        }
        if (msg.type === 'event' || msg.type === 'error') {
          const runId = msg.runId;
          const clientSet = this.clients.get(runId);
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

          // Cleanup jobs map and attachment activeJobs array when a job completes or errors out
          let shouldCleanup = false;
          if (msg.type === 'error') {
            shouldCleanup = true;
          } else if (msg.type === 'event' && msg.payload && (msg.payload.type === 'complete' || msg.payload.type === 'error')) {
            shouldCleanup = true;
          }

          if (shouldCleanup && runId) {
            this.jobs.delete(runId);
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
        console.error("Failed to parse runner message", e);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const tags = this.state.getTags(ws);
    if (tags.includes('runner') || tags.includes('runner-pending')) {
      this.runners.delete(ws);
      if (this.pendingChallenges) {
        this.pendingChallenges.delete(ws);
      }
      // Remove from jobs
      for (const [runId, r] of this.jobs.entries()) {
        if (r === ws) {
          this.jobs.delete(runId);
        }
      }
    } else if (tags.includes('client')) {
      const runId = tags.find(t => t !== 'client');
      if (runId && this.clients.has(runId)) {
        this.clients.get(runId)!.delete(ws);
        if (this.clients.get(runId)!.size === 0) {
          this.clients.delete(runId);
        }
      }
    }
  }

  async webSocketError(ws: WebSocket, error: any) {
    await this.webSocketClose(ws, 1011, "Error", false);
  }
}
