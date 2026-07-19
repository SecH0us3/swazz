import { useAppStore } from '../store/appStore.js';

// In dev, proxy goes to local wrangler via Vite proxy; in prod, use deployed Worker URL
const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export interface ParsingErrorDetails {
    request: {
        url: string;
        method: string;
        headers: Record<string, string>;
        body?: string;
    };
    response?: {
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body?: string;
    };
    error: {
        message: string;
        stack?: string;
        parserDetails?: Record<string, any>;
    };
}

export class ParsingError extends Error {
    details: ParsingErrorDetails;

    constructor(message: string, details: ParsingErrorDetails) {
        super(message);
        this.name = 'ParsingError';
        this.details = details;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ParsingError);
        }
    }
}

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
    const requestBody = JSON.stringify({ url, headers, cookies, forceRebuild });
    const reqUrl = `${PROXY_URL}/api/parse`;

    let res: Response;
    try {
        res = await fetch(reqUrl, {
            method: 'POST',
            headers: requestHeaders,
            body: requestBody,
        });
    } catch (fetchErr: any) {
        throw new ParsingError(fetchErr.message || 'Network request failed', {
            request: { url: reqUrl, method: 'POST', headers: requestHeaders, body: requestBody },
            error: { message: fetchErr.message || String(fetchErr), stack: fetchErr.stack }
        });
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((val, key) => {
        responseHeaders[key] = val;
    });

    if (!res.ok) {
        const responseBody = await res.text().catch(() => '');
        let parsedErr: any = {};
        try {
            const parsed = JSON.parse(responseBody);
            if (parsed && typeof parsed === 'object') {
                parsedErr = parsed;
            }
        } catch {}
        
        throw new ParsingError(parsedErr.error || `Failed to parse swagger: ${res.status}`, {
            request: { url: reqUrl, method: 'POST', headers: requestHeaders, body: requestBody },
            response: { status: res.status, statusText: res.statusText, headers: responseHeaders, body: responseBody },
            error: { message: parsedErr.error || `Failed to parse swagger: ${res.status}` }
        });
    }

    const responseBody = await res.text();
    let data: any;
    try {
        data = JSON.parse(responseBody);
    } catch (jsonErr: any) {
        throw new ParsingError('Invalid JSON response from parser', {
            request: { url: reqUrl, method: 'POST', headers: requestHeaders, body: requestBody },
            response: { status: res.status, statusText: res.statusText, headers: responseHeaders, body: responseBody },
            error: { message: 'Invalid JSON response from parser', stack: jsonErr.stack }
        });
    }

    if (data.error) {
        throw new ParsingError(data.error, {
            request: data.request || { url: reqUrl, method: 'POST', headers: requestHeaders, body: requestBody },
            response: data.response || { status: res.status, statusText: res.statusText, headers: responseHeaders, body: responseBody },
            error: {
                message: data.error,
                parserDetails: data.parserDetails
            }
        });
    }
    if (!data || !data.endpoints || !Array.isArray(data.endpoints)) {
        throw new ParsingError(data?.error || "Invalid spec format: no endpoints array found in parser response", {
            request: data.request || { url: reqUrl, method: 'POST', headers: requestHeaders, body: requestBody },
            response: data.response || { status: res.status, statusText: res.statusText, headers: responseHeaders, body: responseBody },
            error: { message: "Invalid spec format: no endpoints array found in parser response" }
        });
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

    const requestBody = JSON.stringify({ rawSpec });
    const reqUrl = `${PROXY_URL}/api/parse`;

    let res: Response;
    try {
        res = await fetch(reqUrl, {
            method: 'POST',
            headers: requestHeaders,
            body: requestBody,
        });
    } catch (fetchErr: any) {
        throw new ParsingError(fetchErr.message || 'Network request failed', {
            request: { url: reqUrl, method: 'POST', headers: requestHeaders, body: requestBody },
            error: { message: fetchErr.message || String(fetchErr), stack: fetchErr.stack }
        });
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((val, key) => {
        responseHeaders[key] = val;
    });

    if (!res.ok) {
        const responseBody = await res.text().catch(() => '');
        let parsedErr: any = {};
        try {
            const parsed = JSON.parse(responseBody);
            if (parsed && typeof parsed === 'object') {
                parsedErr = parsed;
            }
        } catch {}
        
        throw new ParsingError(parsedErr.error || `Failed to parse spec: ${res.status}`, {
            request: { url: reqUrl, method: 'POST', headers: requestHeaders, body: requestBody },
            response: { status: res.status, statusText: res.statusText, headers: responseHeaders, body: responseBody },
            error: { message: parsedErr.error || `Failed to parse spec: ${res.status}` }
        });
    }

    const responseBody = await res.text();
    let data: any;
    try {
        data = JSON.parse(responseBody);
    } catch (jsonErr: any) {
        throw new ParsingError('Invalid JSON response from parser', {
            request: { url: reqUrl, method: 'POST', headers: requestHeaders, body: requestBody },
            response: { status: res.status, statusText: res.statusText, headers: responseHeaders, body: responseBody },
            error: { message: 'Invalid JSON response from parser', stack: jsonErr.stack }
        });
    }

    if (data.error) {
        throw new ParsingError(data.error, {
            request: data.request || { url: reqUrl, method: 'POST', headers: requestHeaders, body: requestBody },
            response: data.response || { status: res.status, statusText: res.statusText, headers: responseHeaders, body: responseBody },
            error: {
                message: data.error,
                parserDetails: data.parserDetails
            }
        });
    }

    return {
        basePath: data.basePath,
        endpointCount: data.endpoints.length,
        endpoints: data.endpoints,
    };
}

export async function detectMcpServer(urlStr: string): Promise<'sse' | 'http' | null> {
    try {
        // 1. Try SSE check: Send GET request with Accept: text/event-stream header.
        // A true SSE MCP server will keep the connection open and stream events.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const resGet = await fetch(urlStr, {
            method: 'GET',
            headers: { 'Accept': 'text/event-stream' },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const contentType = resGet.headers.get('Content-Type') || '';
        controller.abort();
        if (resGet.ok && contentType.includes('event-stream')) {
            return 'sse';
        }
    } catch {}

    try {
        // 2. Try HTTP JSON-RPC check: Send POST initialize request.
        // Some servers respond with SSE-wrapped JSON (non-standard), others with plain JSON.
        // Both are handled by HTTPClient in the Go engine.
        const resPost = await fetch(urlStr, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(3000),
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

        // Server responded to POST — it's a HTTP JSON-RPC MCP server regardless of content-type
        // (some wrap JSON in SSE streams, Go engine handles both cases in HTTPClient)
        if (resPost.ok || resPost.status === 401 || resPost.status === 403) {
            return 'http';
        }
    } catch {}

    return null;
}
