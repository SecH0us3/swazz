interface Env {
  API_URL: string;
  ASSETS: Fetcher;
}

function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Signal', 'ai-train=no, search=yes');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self' https://challenges.cloudflare.com; connect-src 'self' ws: wss: http: https: https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';");
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
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

    // Proxy API requests to the GCP API URL
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      if (!env.API_URL) {
        response = new Response(
          JSON.stringify({ error: "Backend API_URL is not configured on the frontend Cloudflare worker. Please set the API_URL environment variable." }),
          {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      } else {
        try {
          const targetUrl = new URL(url.pathname + url.search, env.API_URL);
          const newRequest = new Request(targetUrl.toString(), request);
          newRequest.headers.set('host', targetUrl.host);
          response = await fetch(newRequest);
        } catch (error) {
          response = new Response(
            JSON.stringify({ error: "Failed to proxy request to backend. Please check if API_URL is configured correctly." }),
            {
              status: 502,
              headers: { 'Content-Type': 'application/json' }
            }
          );
        }
      }
    } else {
      // Content negotiation: return clean Markdown if requested
      const acceptHeader = request.headers.get("Accept") || "";
      if ((url.pathname === '/' || url.pathname === '/index.html') && acceptHeader.includes("text/markdown")) {
        const markdownUrl = new URL('/index.md', request.url);
        const markdownResponse = await env.ASSETS.fetch(new Request(markdownUrl.toString()));
        if (markdownResponse.ok) {
          const headers = new Headers(markdownResponse.headers);
          headers.set("Content-Type", "text/markdown; charset=utf-8");
          headers.set("Access-Control-Allow-Origin", "*");
          response = new Response(markdownResponse.body, {
            status: markdownResponse.status,
            statusText: markdownResponse.statusText,
            headers: headers
          });
        } else {
          response = await env.ASSETS.fetch(request);
        }
      } else {
        // Otherwise, let the Static Assets engine handle it (or fallback to index.html for SPA)
        response = await env.ASSETS.fetch(request);
      }
    }

    return addSecurityHeaders(response);
  }
};
