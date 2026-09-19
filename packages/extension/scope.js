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

    // People paste what is in the address bar, so a target may arrive as a full
    // URL. Reduce it to a bare host before anything compares it: without this,
    // "http://localhost:8080" split on ':' yielded "http" and the domain never
    // matched, silently capturing nothing.
    function normalizeTarget(hostOrTarget) {
        if (!hostOrTarget) return '';
        let v = String(hostOrTarget).trim().toLowerCase();
        v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
        v = v.split('/')[0];                           // path
        v = v.split('?')[0].split('#')[0];             // query / fragment
        const at = v.lastIndexOf('@');                 // credentials
        if (at !== -1) v = v.substring(at + 1);
        return v;
    }

    function stripPort(hostOrTarget) {
        const s = normalizeTarget(hostOrTarget);
        if (!s) return '';
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
        normalizeTarget,
        stripPort,
        isDomainTargeted,
        isAuthOriginAllowed
    };
});
