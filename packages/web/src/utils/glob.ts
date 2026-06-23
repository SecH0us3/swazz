const regexCache = new Map<string, RegExp>();

function getRegex(pattern: string): RegExp {
    let regex = regexCache.get(pattern);
    if (!regex) {
        const escaped = pattern
            .replace(/[.+^?${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*|\*/g, (m) => (m === '**' ? '.*' : '[^/]*'));
        regex = new RegExp(`^${escaped}$`, 'i');
        regexCache.set(pattern, regex);
    }
    return regex;
}

/**
 * Checks if a given endpoint (method + path) matches any of the glob patterns.
 * Matches case-insensitively (Task 61).
 * Supports:
 * - Exact match: "/api/admin" matching "/api/admin" or "/API/ADMIN"
 * - Segment wildcards using star: "/api/star/users" where star matches a single segment
 * - Recursive wildcards using double-star: "/api/admin/double-star"
 * - Method prefixes: "GET /api/admin" matching "GET /api/admin"
 */
export function matchesPattern(method: string, path: string, patterns: string[]): boolean {
    const key = `${method} ${path}`;
    return patterns.some(p => {
        try {
            // Check if pattern has method prefix, e.g. "GET /api/admin"
            const hasMethodPrefix = /^[A-Z]+\s/i.test(p);
            const regex = getRegex(p);
            
            if (hasMethodPrefix) {
                return regex.test(key);
            } else {
                return regex.test(path) || regex.test(key);
            }
        } catch {
            return false;
        }
    });
}

