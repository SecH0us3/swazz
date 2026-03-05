/**
 * swazz-proxy — Stateless CORS proxy Worker.
 * Receives target URL + headers + cookies + body from the SPA,
 * makes the actual fetch, and returns the response.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {};

const app = new Hono<{ Bindings: Bindings }>();

// ─── CORS ────────────────────────────────────────────────

app.use('*', cors({
    origin: '*',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
}));

// ─── Health check ────────────────────────────────────────

app.get('/', (c) => {
    return c.json({ name: 'swazz-proxy', version: '1.0.0', status: 'ok' });
});

// ─── Proxy endpoint ──────────────────────────────────────

interface ProxyRequest {
    url: string;
    method: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    body?: any;
}

app.post('/proxy', async (c) => {
    let req: ProxyRequest;

    try {
        req = await c.req.json<ProxyRequest>();
    } catch {
        return c.json({ error: 'Invalid JSON body' }, 400);
    }

    // Validate URL
    if (!req.url || typeof req.url !== 'string') {
        return c.json({ error: 'Missing or invalid "url" field' }, 400);
    }

    try {
        new URL(req.url);
    } catch {
        return c.json({ error: `Invalid URL: ${req.url}` }, 400);
    }

    // Build Cookie header from cookies map
    const cookieHeader = req.cookies
        ? Object.entries(req.cookies)
            .filter(([k, v]) => k && v)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ')
        : '';

    // Merge headers
    const finalHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(req.headers || {}),
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };

    const startTime = Date.now();

    try {
        const response = await fetch(req.url, {
            method: req.method || 'POST',
            headers: finalHeaders,
            body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        });

        const duration = Date.now() - startTime;
        let responseBody: string;

        try {
            responseBody = await response.text();
        } catch {
            responseBody = '';
        }

        return c.json({
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseBody,
            duration,
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        const message = err instanceof Error ? err.message : String(err);

        return c.json({
            status: 0,
            headers: {},
            body: '',
            duration,
            error: message,
        }, 502);
    }
});

export default app;
