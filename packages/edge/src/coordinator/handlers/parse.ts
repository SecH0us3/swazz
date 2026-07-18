import { RouteHandler, HandlerContext } from './types';
import { ScansRepository } from '../../repositories/scans';
import { logError } from '../../../../common/logging/logger';
import { ulid } from 'ulidx';

export class ParseHandler implements RouteHandler {
  async handle(request: Request, url: URL, context: HandlerContext): Promise<Response> {
    let body: {
      url?: string;
      rawSpec?: string;
      forceRebuild?: boolean;
      userPublicKey?: string;
      headers?: Record<string, string>;
      cookies?: Record<string, string>;
    } | null = null;
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
        const isLocal = context.env.JWT_SECRET === 'test-secret';
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
        const scansRepo = new ScansRepository(context.env);
        const cached = await scansRepo.getCachedSwagger(body.url);
          
        if (cached && cached.endpoints_r2_key) {
          const r2Object = await context.env.STORAGE.get(cached.endpoints_r2_key);
          if (r2Object) {
            const endpointsText = await r2Object.text();
            let basePath = cached.base_path || '';
            if (basePath.includes("bbad.secmy.app")) {
              const isLocal = context.env.JWT_SECRET === 'test-secret';
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
        logError({ env: context.env, executionCtx: context.state }, "Coordinator", "Failed to read swagger cache from DB/R2", { error: dbErr });
      }
    }

    const activeRunners = Array.from(context.stateManager.runners);
    if (activeRunners.length === 0) return new Response(JSON.stringify({ error: "No active runners connected to Coordinator" }), { status: 503 });
    const reqId = ulid();
    context.stateManager.pendingParseUrls.set(reqId, body.url || 'rawSpec');
    
    let runnerWs = null;
    if (body.userPublicKey) {
      runnerWs = activeRunners.find(r => {
        const tags = context.state.getTags(r);
        return tags.includes(body.userPublicKey!);
      });
    }
    if (!runnerWs) {
      runnerWs = activeRunners.find(r => !context.stateManager.isPrivateRunner(r)) || null;
    }

    if (!runnerWs) {
      context.stateManager.pendingParseUrls.delete(reqId);
      return new Response(JSON.stringify({ error: "No compatible runner connected to Coordinator" }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    try {
      runnerWs.send(JSON.stringify({
        type: 'parse_request',
        reqId,
        payload: {
          url: body.url || '',
          rawSpec: body.rawSpec || '',
          headers: body.headers || {},
          cookies: body.cookies || {}
        }
      }));
    } catch (err) {
      context.stateManager.pendingParseUrls.delete(reqId);
      return new Response(JSON.stringify({ error: "Failed to send parse request to runner" }), { status: 500 });
    }
    
    return new Promise<Response>((resolve) => {
      context.stateManager.pendingParses.set(reqId, resolve);
      setTimeout(() => {
        if (context.stateManager.pendingParses.has(reqId)) {
          context.stateManager.pendingParses.delete(reqId);
          context.stateManager.pendingParseUrls.delete(reqId);
          resolve(new Response(JSON.stringify({ error: "Parse timeout from Go runner" }), { status: 504 }));
        }
      }, 30000);
    });
  }
}
