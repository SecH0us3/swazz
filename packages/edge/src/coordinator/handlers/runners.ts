// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { RouteHandler, HandlerContext } from './types';
import { isVersionOutdated, getPublicKeyFromTags } from '../utils';
import { getRunnerOwnerId, isRunnerOwnedBy, isSharedRunnerTags, SHARED_RUNNER_TAG } from '../runnerAccess';
import { logWarn } from '../../../../common/logging/logger';
import { ulid } from 'ulidx';
import { parseResumeParam, resumeRuns } from '../resume';
import { DELIVERY_HEADER } from '../delivery';

export class RunnersHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const runnerList = [];
    context.stateManager.pruneDeadRunners();
    const allWebSockets = new Set([...context.stateManager.runners, ...context.stateManager.pendingChallenges.keys()]);
    for (const ws of allWebSockets) {
      const tags = context.state.getTags(ws);
      const isPending = tags.includes('runner-pending') && !context.stateManager.runners.has(ws);
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
        ownerId: getRunnerOwnerId(tags),
        publicKey: pubKey,
        status: isPending ? 'authenticating' : 'connected',
        isShared: isSharedRunnerTags(tags),
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
    const userId = url.searchParams.get('userId');
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

    if (isSharedRunnerTags(tags)) {
      return new Response('Forbidden: Shared runners cannot be restarted', { status: 403 });
    }

    // Auth-disabled (local) mode has no tenants, so every runner is the operator's own.
    if (String(context.env.AUTH_ENABLED) !== 'false' && !isRunnerOwnedBy(tags, userId)) {
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
    // Set by the Worker after it authenticated the connection; never taken from the client.
    const isShared = url.searchParams.get('shared') === '1';
    const userId = isShared ? '' : (url.searchParams.get('user_id') || '');
    const name = url.searchParams.get('name') || 'Unnamed Runner';
    const version = url.searchParams.get('version') || 'v1.0.0';
    const nameTag = `name:${name}`;
    const versionTag = `version:${version}`;
    const userIdTag = userId ? `user_id:${userId}` : '';
    // Agents that send heartbeats are dropped once they go silent (see pruneDeadRunners).
    const heartbeat = url.searchParams.get('heartbeat') === '1' ? { heartbeat: true, connectedAt: Date.now() } : {};
    context.stateManager.pruneDeadRunners();
    // Runs this agent is still executing from a connection that dropped (see resume.ts).
    const resume = parseResumeParam(url.searchParams.get('resume'));
    
    if (publicKey) {
      const tags = ["runner-pending", publicKey, nameTag, versionTag];
      if (userIdTag) tags.push(userIdTag);
      context.state.acceptWebSocket(server, tags);
      
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
        
      context.stateManager.pendingChallenges.set(server, nonce);
      const connectionId = ulid();
      // A keyed runner's claims wait until it has proven its key (WebSocketHandler).
      server.serializeAttachment({ authenticated: false, nonce, connectionId, ...heartbeat, ...(resume.length ? { resume } : {}) });
      
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
      if (isShared) tags.push(SHARED_RUNNER_TAG);
      if (userIdTag) tags.push(userIdTag);
      context.state.acceptWebSocket(server, tags);
      const connectionId = ulid();
      server.serializeAttachment({ authenticated: true, connectionId, ...heartbeat });
      context.stateManager.runners.add(server);
      // Before dispatching: a resumed run must not be handed out again as an orphan.
      await resumeRuns(context, server, resume);

      const coordinatorVersion = context.env.VERSION || '1.0.0';
      if (isVersionOutdated(version, coordinatorVersion)) {
        logWarn({ env: context.env, executionCtx: context.state }, "Coordinator", `[Runner Connection] Outdated runner agent connected: '${name}' (${isShared ? 'Shared' : 'Token'}) is running version ${version}, but coordinator expects version ${coordinatorVersion}. Please update the agent.`);
      }

      await context.queueService.checkAndDispatchQueuedScans(server);
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      // This coordinator acknowledges run events, so the agent may keep and replay them.
      headers: { [DELIVERY_HEADER]: 'ack' },
    });
  }
}
