import { parseSwaggerSpec } from '@swazz/core';

// In dev, proxy goes to local wrangler via Vite proxy; in prod, use deployed Worker URL
const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

export async function loadSwaggerUrl(
    url: string,
    headers: Record<string, string>,
    cookies: Record<string, string>,
): Promise<{ basePath: string; endpointCount: number; endpoints: any[] }> {
    let specText: string;
    try {
        const res = await fetch(`${PROXY_URL}/proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, method: 'GET', headers, cookies }),
        });
        const result = await res.json();
        specText = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    } catch {
        // Direct fetch fallback
        const res = await fetch(url);
        specText = await res.text();
    }

    const spec = JSON.parse(specText);
    const { basePath, endpoints } = parseSwaggerSpec(spec);
    return { basePath, endpointCount: endpoints.length, endpoints };
}
