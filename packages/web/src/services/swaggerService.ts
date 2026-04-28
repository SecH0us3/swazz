// In dev, proxy goes to local wrangler via Vite proxy; in prod, use deployed Worker URL
const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

export async function loadSwaggerUrl(
    url: string,
    headers?: Record<string, string>,
    cookies?: Record<string, string>,
): Promise<{ basePath: string; endpointCount: number; endpoints: any[] }> {
    const res = await fetch(`${PROXY_URL}/api/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }), // we can pass headers/cookies if the Go backend supports it eventually
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
    };
}
