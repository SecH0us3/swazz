import { RouteHandler, HandlerContext } from './types';

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

    await context.state.storage.put(`config:${payload.runId}`, payload.config || {});
    await context.state.storage.put(`user_public_key:${payload.runId}`, payload.userPublicKey || "");

    const activeRunners = Array.from(context.stateManager.runners);
    if (activeRunners.length === 0) {
      return new Response('No runners available', { status: 503 });
    }
    
    const dispatchMsg = JSON.stringify({
      type: 'job_dispatch',
      payload,
    });

    let runner = null;
    if (context.env.AUTH_ENABLED === 'false' || (context.env.AUTH_ENABLED as any) === false) {
      runner = activeRunners[0] || null;
    } else {
      if (payload.userPublicKey) {
        runner = activeRunners.find(r => {
          const tags = context.state.getTags(r);
          return tags.includes(payload.userPublicKey);
        });
      }
      if (!runner && !payload?.config?.settings?.disable_shared_runners) {
        runner = activeRunners.find(r => !context.stateManager.isPrivateRunner(r)) || null;
      }
    }

    if (runner) {
      context.stateManager.jobs.set(payload.runId, runner);
      const attachment = runner.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null || {};
      const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
      if (!activeJobs.includes(payload.runId)) {
        activeJobs.push(payload.runId);
        runner.serializeAttachment({ ...attachment, activeJobs });
      }
      try {
        runner.send(dispatchMsg);
        await context.state.storage.delete(`config:${payload.runId}`);
        await context.state.storage.delete(`user_public_key:${payload.runId}`);
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
    const activeRunners = Array.from(context.stateManager.runners);
    if (activeRunners.length === 0) return new Response("No runners available", { status: 503 });
    
    const runnerWs = activeRunners.find(r => !context.stateManager.isPrivateRunner(r));
    if (!runnerWs) {
      return new Response("No shared runners available", { status: 503 });
    }
    context.stateManager.jobs.set(runId, runnerWs);
    const attachment = runnerWs.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null || {};
    const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
    if (!activeJobs.includes(runId)) {
      activeJobs.push(runId);
      runnerWs.serializeAttachment({ ...attachment, activeJobs });
    }
    let parsedConfig: any;
    try {
      parsedConfig = JSON.parse(configText).config;
    } catch (err) {
      return new Response('Invalid JSON config', { status: 400 });
    }
    try {
      runnerWs.send(JSON.stringify({ type: 'start', runId, config: parsedConfig }));
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
