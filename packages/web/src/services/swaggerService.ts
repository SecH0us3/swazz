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
    return {
        basePath: data.basePath,
        endpointCount: data.endpoints.length,
        endpoints: data.endpoints,
        cachedAt: data.cachedAt,
    };
}
