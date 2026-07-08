import { Env } from '../env';
import { StateManager } from './StateManager';
import { QueueService } from './QueueService';
import { ScansRepository } from '../repositories/scans';
import { ulid } from 'ulidx';
import { logError, logWarn } from '../../../common/logging/logger';
import { isVersionOutdated, getPublicKeyFromTags } from './utils';

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
        const pubKey = getPublicKeyFromTags(tags) || null;
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
      const pubKey = getPublicKeyFromTags(tags) || null;

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
        
        try {
          server.send(JSON.stringify({ type: 'challenge', nonce }));
        } catch { /* ignored */ }
        
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
