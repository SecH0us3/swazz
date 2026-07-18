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

    const requestBody = JSON.stringify({ url, forceRebuild });
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
