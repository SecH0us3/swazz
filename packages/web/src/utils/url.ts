// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * Schemes the engine targets besides HTTP. ValidateBaseURL accepts each of these and
 * executor_http.go routes on them, so the UI must let them through untouched instead
 * of treating them as a scheme-less host.
 */
const NON_HTTP_SCHEMES = ['ws://', 'wss://', 'grpc://', 'grpcs://'];

/** Whether the URL already carries a scheme the engine understands. */
export function hasSupportedScheme(url: string): boolean {
    const lower = url.trim().toLowerCase();
    return lower.startsWith('http://') || lower.startsWith('https://') || NON_HTTP_SCHEMES.some((s) => lower.startsWith(s));
}

/**
 * Sanitizes a target API URL down to scheme + domain (origin).
 * E.g.: "https://example.com/swagger.json" -> "https://example.com"
 * E.g.: "http://127.0.0.1:8788/api/v1" -> "http://127.0.0.1:8788"
 * E.g.: "example.com/swagger.json" -> "https://example.com"
 * E.g.: "ws://localhost:50052/ws" -> "ws://localhost:50052"
 */
export function sanitizeTargetUrl(url: string): string {
    let cleanUrl = url ? url.trim() : '';
    if (!cleanUrl) return '';

    // A ws:// or grpc:// target used to fall through to the branch below, which
    // prepended https:// and left new URL() reading "ws" as the host — the fuzzer was
    // then pointed at https://ws and every request failed.
    const lower = cleanUrl.toLowerCase();
    if (NON_HTTP_SCHEMES.some((s) => lower.startsWith(s))) {
        try {
            const u = new URL(cleanUrl);
            // grpc:// and grpcs:// are not "special" schemes, so URL.origin is the
            // literal string "null" for them. Build the origin from the parts instead.
            return u.host ? `${u.protocol}//${u.host}` : cleanUrl;
        } catch {
            return cleanUrl;
        }
    }

    // Prepend scheme if missing
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        if (cleanUrl.startsWith('localhost') || cleanUrl.startsWith('127.0.0.1') || cleanUrl.startsWith('0.0.0.0')) {
            cleanUrl = `http://${cleanUrl}`;
        } else {
            cleanUrl = `https://${cleanUrl}`;
        }
    }

    try {
        const u = new URL(cleanUrl);
        return u.origin;
    } catch {
        return cleanUrl;
    }
}

/**
 * Normalizes what the user typed into a spec/target field before it is used: adds a
 * default scheme only when none of the supported ones is present. Shared by the
 * sidebar loader and the API Specs tab, which each carried their own copy that also
 * mangled ws:// and grpc:// URLs.
 */
export function normalizeSpecUrl(url: string): string {
    const cleanUrl = url ? url.trim() : '';
    if (!cleanUrl) return '';
    if (hasSupportedScheme(cleanUrl) || cleanUrl.includes('localhost')) return cleanUrl;
    return `https://${cleanUrl}`;
}
