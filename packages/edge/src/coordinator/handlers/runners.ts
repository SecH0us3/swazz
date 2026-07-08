import { RouteHandler, HandlerContext } from './types';
import { isVersionOutdated, getPublicKeyFromTags } from '../utils';
import { logWarn } from '../../../../common/logging/logger';
import { ulid } from 'ulidx';

export class RunnersHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const runnerList = [];
    for (const ws of context.stateManager.runners) {
      const tags = context.state.getTags(ws);
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
}

export class RestartRunnerHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const connectionId = url.searchParams.get('connectionId');
    const userPublicKey = url.searchParams.get('userPublicKey');
    if (!connectionId) {
      return new Response('Missing connectionId', { status: 400 });
    }

    let runnerWs = null;
    for (const ws of context.stateManager.runners) {
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

    const tags = context.state.getTags(runnerWs);
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
}

export class ConnectRunnerHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
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
      context.state.acceptWebSocket(server, tags);
      
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
        
      context.stateManager.pendingChallenges.set(server, nonce);
      const connectionId = ulid();
      server.serializeAttachment({ authenticated: false, nonce, connectionId });
      
      try {
        server.send(JSON.stringify({ type: 'challenge', nonce }));
      } catch { /* ignored */ }
      
      setTimeout(() => {
        try {
          if (!context.stateManager.runners.has(server)) {
            server.close(1008, "Authentication timeout");
          }
        } catch { /* ignored */ }
      }, 5000);
    } else {
      const tags = ["runner", nameTag, versionTag];
      if (userIdTag) tags.push(userIdTag);
      context.state.acceptWebSocket(server, tags);
      const connectionId = ulid();
      server.serializeAttachment({ authenticated: true, connectionId });
      context.stateManager.runners.add(server);

      const coordinatorVersion = context.env.VERSION || '1.0.0';
      if (isVersionOutdated(version, coordinatorVersion)) {
        logWarn(context.env, "Coordinator", `[Runner Connection] Outdated runner agent connected: '${name}' (Shared) is running version ${version}, but coordinator expects version ${coordinatorVersion}. Please update the agent.`);
      }

      await context.queueService.checkAndDispatchQueuedScans(server);
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
}
