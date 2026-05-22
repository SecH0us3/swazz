interface Env {
  API: Fetcher;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Proxy API requests internally to the swazz-api Worker
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      return env.API.fetch(request);
    }

    // Content negotiation: return clean Markdown if requested
    const acceptHeader = request.headers.get("Accept") || "";
    if (acceptHeader.includes("text/markdown")) {
      const markdownUrl = new URL('/index.md', request.url);
      const markdownResponse = await env.ASSETS.fetch(new Request(markdownUrl.toString(), request));
      if (markdownResponse.ok) {
        const body = await markdownResponse.text();
        return new Response(body, {
          status: markdownResponse.status,
          statusText: markdownResponse.statusText,
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          }
        });
      }
    }

    // Otherwise, let the Static Assets engine handle it (or fallback to index.html for SPA)
    return env.ASSETS.fetch(request);
  }
};
