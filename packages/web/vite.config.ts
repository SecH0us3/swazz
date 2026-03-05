import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * Dev-only proxy plugin — replaces the Worker during development.
 * Handles POST /proxy requests by forwarding them to the target URL
 * with the specified headers and cookies. No need to run wrangler.
 */
function devProxyPlugin(): Plugin {
    return {
        name: 'swazz-dev-proxy',
        configureServer(server) {
            server.middlewares.use('/proxy', async (req, res) => {
                // Only POST
                if (req.method !== 'POST') {
                    res.writeHead(405, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Method not allowed' }));
                    return;
                }

                // Read body
                let body = '';
                for await (const chunk of req) {
                    body += chunk;
                }

                let payload: {
                    url: string;
                    method: string;
                    headers?: Record<string, string>;
                    cookies?: Record<string, string>;
                    body?: any;
                };

                try {
                    payload = JSON.parse(body);
                } catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }

                if (!payload.url) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Missing url' }));
                    return;
                }

                // Build headers
                const headers: Record<string, string> = {
                    ...(payload.headers || {}),
                };

                // Merge cookies into Cookie header
                if (payload.cookies && Object.keys(payload.cookies).length > 0) {
                    const cookieStr = Object.entries(payload.cookies)
                        .map(([k, v]) => `${k}=${v}`)
                        .join('; ');
                    headers['Cookie'] = headers['Cookie']
                        ? `${headers['Cookie']}; ${cookieStr}`
                        : cookieStr;
                }

                // Forward the request
                const start = Date.now();
                try {
                    const fetchRes = await fetch(payload.url, {
                        method: payload.method || 'GET',
                        headers,
                        body: payload.method !== 'GET' && payload.body
                            ? (typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body))
                            : undefined,
                    });

                    const duration = Date.now() - start;
                    let responseBody: any;
                    const contentType = fetchRes.headers.get('content-type') || '';
                    if (contentType.includes('json')) {
                        responseBody = await fetchRes.json();
                    } else {
                        responseBody = await fetchRes.text();
                    }

                    // Return result with CORS headers
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    });
                    res.end(JSON.stringify({
                        status: fetchRes.status,
                        headers: Object.fromEntries(fetchRes.headers.entries()),
                        body: responseBody,
                        duration,
                    }));
                } catch (err: any) {
                    const duration = Date.now() - start;
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    });
                    res.end(JSON.stringify({
                        status: 0,
                        headers: {},
                        body: null,
                        duration,
                        error: err.message || String(err),
                    }));
                }
            });
        },
    };
}

export default defineConfig({
    plugins: [react(), devProxyPlugin()],
    server: {
        port: 5173,
    },
    resolve: {
        conditions: ['module'],
    },
});
