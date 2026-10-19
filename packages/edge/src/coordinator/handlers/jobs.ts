// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { RouteHandler, HandlerContext } from './types';
import { isValidScanConfigKey, isScanConfigKeyForRun, getScanConfig, deleteScanConfig } from '../../services/scanConfigStore';
import { ScansRepository } from '../../repositories/scans';
import { clearScanState, recordJobRunner } from '../utils';
import { isRunnerOwnedBy, configForRunner, runnerIdentity } from '../runnerAccess';

export class DispatchHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    let payload: any = null;
    try {
      payload = await request.json();
    } catch (err) {
      return new Response('Invalid JSON payload', { status: 400 });
    }
    if (!payload) {
      return new Response('Missing payload', { status: 400 });
    }
    if (payload.runId && context.stateManager.jobs.has(payload.runId)) {
      return new Response('Already dispatched', { status: 200 });
    }

    let config: any;
    const configKey: string | undefined = payload.configKey;

    if (configKey) {
      if (!isScanConfigKeyForRun(configKey, payload.runId)) {
        return new Response('Invalid scan config key', { status: 400 });
      }
      try {
        config = await getScanConfig(context.env, configKey);
      } catch (err) {
        console.error(`[DispatchHandler] Failed to load scan config from R2: ${configKey}`, err);
        return new Response('Failed to load scan config', { status: 500 });
      }
      await context.state.storage.put(`config_ref:${payload.runId}`, configKey);
      await context.state.storage.put(`config_meta:${payload.runId}`, { disableShared: !!config?.settings?.disable_shared_runners });
    } else {
      config = payload.config || {};
      await context.state.storage.put(`config:${payload.runId}`, config);
    }

    await context.state.storage.put(`user_public_key:${payload.runId}`, payload.userPublicKey || "");

    const scansRepo = new ScansRepository(context.env);
    const status = await scansRepo.getScanStatus(payload.runId);
    if (status !== 'queued') {
      await clearScanState(context.state.storage, payload.runId);
      if (configKey) {
        await deleteScanConfig(context.env, configKey);
      }
      return new Response('Scan not dispatchable', { status: 409 });
    }

    if (context.stateManager.jobs.has(payload.runId)) {
      return new Response('Already dispatched', { status: 200 });
    }

    context.stateManager.pruneDeadRunners();
    const activeRunners = Array.from(context.stateManager.runners);
    if (activeRunners.length === 0) {
      return new Response('No runners available', { status: 503 });
    }
    
    let runner = null;
    if (String(context.env.AUTH_ENABLED) === 'false') {
      runner = activeRunners.find(r => context.stateManager.hasCapacity(r)) || null;
    } else {
      let hasMatchingPrivateRunner = false;
      if (payload.userId) {
        const matchingPrivate = activeRunners.filter(r =>
          !context.stateManager.isSharedRunner(r) && isRunnerOwnedBy(context.state.getTags(r), payload.userId)
        );
        hasMatchingPrivateRunner = matchingPrivate.length > 0;
        runner = matchingPrivate.find(r => context.stateManager.hasCapacity(r)) || null;
      }
      // Only fall back to a shared runner if the user has no connected runner of their own,
      // has not registered a private runner key, and has not disabled shared runners. If their
      // runner is connected but full, or offline, keep the scan queued for it.
      if (!runner && !hasMatchingPrivateRunner && !payload.userPublicKey && !config?.settings?.disable_shared_runners) {
        runner = activeRunners.find(r => context.stateManager.isSharedRunner(r) && context.stateManager.hasCapacity(r)) || null;
      }
    }

    if (runner) {
      const dispatchMsg = JSON.stringify({
        type: 'job_dispatch',
        payload: {
          runId: payload.runId,
          config: configForRunner(config, context.state.getTags(runner), context.env),
          userPublicKey: payload.userPublicKey || "",
        },
      });
      context.stateManager.jobs.set(payload.runId, runner);
      const attachment = runner.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null || {};
      const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
      if (!activeJobs.includes(payload.runId)) {
        activeJobs.push(payload.runId);
        runner.serializeAttachment({ ...attachment, activeJobs });
      }
      try {
        runner.send(dispatchMsg);
        await recordJobRunner(context.state.storage, payload.runId, runnerIdentity(context.state.getTags(runner)));
        await clearScanState(context.state.storage, payload.runId);
        if (configKey) {
          await deleteScanConfig(context.env, configKey);
        }
        return new Response('Dispatched', { status: 200 });
      } catch (err) {
        context.stateManager.runners.delete(runner);
        context.stateManager.jobs.delete(payload.runId);
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
}

export class CommandHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    let payload: any = null;
    try {
      payload = await request.json();
    } catch (err) {
      return new Response('Invalid JSON payload', { status: 400 });
    }
    if (!payload || !payload.runId) {
      return new Response('Missing runId', { status: 400 });
    }

    const runner = context.stateManager.jobs.get(payload.runId);

    if (payload.command === 'stop') {
      if (!runner) {
        try {
          const scansRepo = new ScansRepository(context.env);
          const marked = await scansRepo.markFailedIfActive(payload.runId);
          if (marked) {
            const ref = await context.state.storage.get<string>(`config_ref:${payload.runId}`);
            await clearScanState(context.state.storage, payload.runId);
            if (ref) {
              await deleteScanConfig(context.env, ref);
            }
          }
        } catch (err) {
          console.error(`[CommandHandler] Error terminating undispatched scan ${payload.runId}:`, err);
        }
      }
    }

    if (runner) {
      runner.send(JSON.stringify({
        type: 'job_command',
        payload,
      }));
      return new Response('Command sent', { status: 200 });
    }
    return new Response('Runner not found for job', { status: 404 });
  }
}

export class StartRunHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const runId = url.searchParams.get('runId');
    if (!runId) {
      return new Response('Missing runId', { status: 400 });
    }
    const configText = await request.text();
    context.stateManager.pruneDeadRunners();
    const activeRunners = Array.from(context.stateManager.runners);
    if (activeRunners.length === 0) return new Response("No runners available", { status: 503 });
    
    // Auth-disabled (local) mode has no tenants, so any runner will do, as in dispatch.
    const authDisabled = String(context.env.AUTH_ENABLED) === 'false';
    const runnerWs = activeRunners.find(r => (authDisabled || context.stateManager.isSharedRunner(r)) && context.stateManager.hasCapacity(r));
    if (!runnerWs) {
      return new Response("No shared runners available", { status: 503 });
    }
    // Parse before reserving a slot: a rejected body must not leave a phantom job on the runner.
    let parsedConfig: any;
    try {
      parsedConfig = JSON.parse(configText).config;
    } catch (err) {
      return new Response('Invalid JSON config', { status: 400 });
    }
    context.stateManager.jobs.set(runId, runnerWs);
    const attachment = runnerWs.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null || {};
    const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
    if (!activeJobs.includes(runId)) {
      activeJobs.push(runId);
      runnerWs.serializeAttachment({ ...attachment, activeJobs });
    }
    try {
      runnerWs.send(JSON.stringify({ type: 'start', runId, config: configForRunner(parsedConfig, context.state.getTags(runnerWs), context.env) }));
    } catch (err) {
      context.stateManager.runners.delete(runnerWs);
      context.stateManager.jobs.delete(runId);
      const updatedAttachment = runnerWs.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null || {};
      const updatedJobs = updatedAttachment.activeJobs ? [...updatedAttachment.activeJobs] : [];
      const index = updatedJobs.indexOf(runId);
      if (index > -1) {
        updatedJobs.splice(index, 1);
        runnerWs.serializeAttachment({ ...updatedAttachment, activeJobs: updatedJobs });
      }
      return new Response("Failed to send start command to runner", { status: 500 });
    }
    await recordJobRunner(context.state.storage, runId, runnerIdentity(context.state.getTags(runnerWs)));
    return new Response("ok");
  }
}

export class ControlRunHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    const runId = url.searchParams.get('runId');
    const action = url.searchParams.get('action');
    if (!runId || !action) {
      return new Response('Missing runId or action', { status: 400 });
    }
    const runnerWs = context.stateManager.jobs.get(runId);
    if (runnerWs) {
      try {
        runnerWs.send(JSON.stringify({ type: action, runId }));
      } catch (err) {
        // ignore
      }
    }
    return new Response("ok");
  }
}
