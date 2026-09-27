// Default Swazz dashboard URL. The production zip build (build-zip.mjs --mode prod)
// rewrites this file in a staging copy; the source always keeps the local-dev value.
(function (root) {
    root.SWAZZ_DEFAULT_URL = 'http://localhost:5173';
})(typeof self !== 'undefined' ? self : globalThis);
