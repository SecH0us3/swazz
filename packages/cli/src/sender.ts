/**
 * Node.js request sender — direct fetch, no CORS proxy needed.
 */

import type { SendRequestFn } from '@swazz/core';

export const nodeSender: SendRequestFn = async (req) => {
    const start = Date.now();

    const headers = new Headers(req.headers);

    // Merge cookies into Cookie header
    if (req.cookies && Object.keys(req.cookies).length > 0) {
        const existing = headers.get('cookie') || '';
        const newCookies = Object.entries(req.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
        headers.set('cookie', existing ? `${existing}; ${newCookies}` : newCookies);
    }

    // Serialize request body based on Content-Type
    let requestBody: string | undefined;
    if (req.body !== undefined) {
        const reqContentType = headers.get('content-type') ?? '';
        if (reqContentType.includes('x-www-form-urlencoded') && typeof req.body === 'object' && req.body !== null) {
            requestBody = new URLSearchParams(req.body as Record<string, string>).toString();
        } else {
            requestBody = JSON.stringify(req.body);
        }
    }

    const res = await fetch(req.url, {
        method: req.method,
        headers,
        body: requestBody,
    });

    const duration = Date.now() - start;

    let body: any;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json')) {
        try {
            body = await res.json();
        } catch {
            body = await res.text();
        }
    } else {
        body = await res.text();
    }

    return { status: res.status, body, duration };
};
