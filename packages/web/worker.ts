interface Env {
  API: Fetcher;
  ASSETS: Fetcher;
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

    // Proxy API requests internally to the swazz-api Worker
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      response = await env.API.fetch(request);
    } else {
      // Content negotiation: return clean Markdown if requested
      const acceptHeader = request.headers.get("Accept") || "";
      if (acceptHeader.includes("text/markdown")) {
        const markdownUrl = new URL('/index.md', request.url);
        const markdownResponse = await env.ASSETS.fetch(new Request(markdownUrl.toString(), request));
        if (markdownResponse.ok) {
          const body = await markdownResponse.text();
          response = new Response(body, {
            status: markdownResponse.status,
            statusText: markdownResponse.statusText,
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
            }
          });
        } else {
          response = await env.ASSETS.fetch(request);
        }
      } else {
        // Otherwise, let the Static Assets engine handle it (or fallback to index.html for SPA)
        response = await env.ASSETS.fetch(request);
      }
    }

    return addContentSignalHeader(response);
  }
};
