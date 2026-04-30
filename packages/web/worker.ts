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

    // Otherwise, let the Static Assets engine handle it (or fallback to index.html for SPA)
    return env.ASSETS.fetch(request);
  }
};
