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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ─── Health check at edge level ──────────────────────────
    if (url.pathname === "/") {
      return new Response(
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
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      const id = env.SWAZZ_DO.idFromName("global-swazz");
      const stub = env.SWAZZ_DO.get(id);
      return stub.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
