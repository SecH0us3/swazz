import { Container } from "@cloudflare/containers";

/**
 * SwazzContainer — Durable Object that wraps the Go container.
 * All API traffic is proxied through this DO to the Go HTTP server.
 */
export class SwazzContainer extends Container {
  defaultPort = 8080;

  // Override sleep timeout to keep container warm between requests.
  // Default is 30s; 120s reduces cold starts during active sessions.
  sleepAfter = 120;
}

interface Env {
  SWAZZ_DO: DurableObjectNamespace;
}

function addContentSignalHeader(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Signal', 'ai-train=no, search=yes');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;

    // ─── Health check at edge level ──────────────────────────
    if (url.pathname === "/") {
      response = new Response(
        JSON.stringify({
          service: "swazz-edge",
          status: "ok",
          message: "Use /api/* to interact with the fuzzing engine",
        }),
        {
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    // ─── API routes → proxy to Go container ──────────────────
    else if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      const id = env.SWAZZ_DO.idFromName("global-swazz");
      const stub = env.SWAZZ_DO.get(id);
      response = await stub.fetch(request);
    } else {
      response = new Response("Not Found", { status: 404 });
    }

    return addContentSignalHeader(response);
  },
};
