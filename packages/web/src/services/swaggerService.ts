import { useAppStore } from '../store/appStore.js';

// In dev, proxy goes to local wrangler via Vite proxy; in prod, use deployed Worker URL
const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export async function loadSwaggerUrl(
    url: string,
    headers?: Record<string, string>,
    cookies?: Record<string, string>,
    forceRebuild?: boolean,
): Promise<{ basePath: string; endpointCount: number; endpoints: any[]; cachedAt?: string }> {
    const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
    if (token) {
        requestHeaders['Authorization'] = `Bearer ${token}`;
    }
    const csrfToken = useAppStore.getState().csrfToken;
    if (csrfToken) {
        requestHeaders['X-CSRF-Token'] = csrfToken;
    }

    const res = await fetch(`${PROXY_URL}/api/parse`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ url, forceRebuild }), // we can pass headers/cookies if the Go backend supports it eventually
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Failed to parse swagger: ${res.status}`);
    }

    const data = await res.json();
    if (!data || !data.endpoints || !Array.isArray(data.endpoints)) {
        throw new Error(data?.error || "Invalid spec format: no endpoints array found in parser response");
    }
    return {
        basePath: data.basePath,
        endpointCount: data.endpoints.length,
        endpoints: data.endpoints,
        cachedAt: data.cachedAt,
    };
}

export async function parseRawSpec(
    rawSpec: string,
): Promise<{ basePath: string; endpointCount: number; endpoints: any[] }> {
    const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
    if (token) {
        requestHeaders['Authorization'] = `Bearer ${token}`;
    }
    const csrfToken = useAppStore.getState().csrfToken;
    if (csrfToken) {
        requestHeaders['X-CSRF-Token'] = csrfToken;
    }

    const res = await fetch(`${PROXY_URL}/api/parse`, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify({ rawSpec }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Failed to parse spec: ${res.status}`);
    }

    const data = await res.json();
    return {
        basePath: data.basePath,
        endpointCount: data.endpoints.length,
        endpoints: data.endpoints,
    };
}

export async function detectMcpServer(urlStr: string): Promise<'sse' | 'http' | null> {
    try {
        // 1. Try SSE check: Send GET request with Accept header
        const resGet = await fetch(urlStr, {
            method: 'GET',
            headers: { 'Accept': 'text/event-stream' }
        });
        const contentType = resGet.headers.get('Content-Type') || '';
        if (resGet.ok && contentType.includes('event-stream')) {
            return 'sse';
        }
    } catch {}

    try {
        // 2. Try HTTP JSON-RPC check: Send POST initialize request
        const resPost = await fetch(urlStr, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'initialize',
                id: 1,
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'swazz-detector', version: '1.0.0' }
                }
            })
        });
        if (resPost.ok) {
            const data = await resPost.json();
            if (data && data.jsonrpc === '2.0' && (data.result?.protocolVersion || data.error)) {
                return 'http';
            }
        }
    } catch {}

    return null;
}

