/**
 * Sanitizes a target API URL down to scheme + domain (origin).
 * E.g.: "https://example.com/swagger.json" -> "https://example.com"
 * E.g.: "http://127.0.0.1:8788/api/v1" -> "http://127.0.0.1:8788"
 * E.g.: "example.com/swagger.json" -> "https://example.com"
 */
export function sanitizeTargetUrl(url: string): string {
    let cleanUrl = url ? url.trim() : '';
    if (!cleanUrl) return '';

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
