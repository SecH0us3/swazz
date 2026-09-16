/**
 * Swazz Traffic Capturer - Scope & Origin Security Helpers
 * Shared between background service worker, content scripts, and tests.
 */
(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else {
        root.SwazzScope = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {

    function stripPort(hostOrTarget) {
        if (!hostOrTarget) return '';
        const s = hostOrTarget.trim().toLowerCase();
        if (s.startsWith('[')) {
            const closingBracketIndex = s.indexOf(']');
            if (closingBracketIndex !== -1) {
                return s.substring(0, closingBracketIndex + 1);
            }
        }
        return s.split(':')[0];
    }

    function isDomainTargeted(host, targetDomains) {
        if (!targetDomains || targetDomains.length === 0) return false;
        const cleanHost = stripPort(host);
        if (!cleanHost) return false;
        return targetDomains.some(target => {
            const t = stripPort(target);
            if (!t) return false;
            // Only allow exact match or subdomain (not substring to prevent spoofing)
            return cleanHost === t || cleanHost.endsWith('.' + t);
        });
    }

    function isAuthOriginAllowed(originOrUrl) {
        if (!originOrUrl) return false;
        try {
            const u = new URL(originOrUrl);
            const host = u.host.toLowerCase();
            const cleanHost = stripPort(host);

            // Allow localhost:5173 over http or https
            if (cleanHost === 'localhost' && (u.port === '5173' || host === 'localhost:5173')) {
                return u.protocol === 'http:' || u.protocol === 'https:';
            }

            // Require https for swazz.secmy.app and its subdomains
            if (u.protocol === 'https:') {
                if (cleanHost === 'swazz.secmy.app' || cleanHost.endsWith('.swazz.secmy.app')) {
                    return true;
                }
            }

            return false;
        } catch (e) {
            return false;
        }
    }

    return {
        stripPort,
        isDomainTargeted,
        isAuthOriginAllowed
    };
});
