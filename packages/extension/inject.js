(function() {
    // Prevent double injection
    if (window.__swazz_intercept_loaded) return;
    window.__swazz_intercept_loaded = true;

    function formatHeaders(headers) {
        const result = {};
        if (!headers) return result;
        if (headers instanceof Headers) {
            for (const [key, value] of headers.entries()) {
                result[key] = value;
            }
        } else if (Array.isArray(headers)) {
            headers.forEach(([key, value]) => {
                result[key] = value;
            });
        } else if (typeof headers === 'object') {
            Object.assign(result, headers);
        }
        return result;
    }

    function sendRequestLog(url, method, headers, body) {
        try {
            // Absolute URL check
            const absoluteUrl = new URL(url, window.location.href).href;
            
            // Post message to isolated content script
            window.postMessage({
                source: 'swazz-detector',
                type: 'request',
                data: {
                    url: absoluteUrl,
                    method: method.toUpperCase(),
                    headers: formatHeaders(headers),
                    body: body || ''
                }
            }, window.location.origin);
        } catch (e) {
            // Silently ignore URL parsing errors
        }
    }

    // 1. Intercept Fetch API
    if (window.fetch) {
        const originalFetch = window.fetch;
        window.fetch = function(resource, config) {
            let url = "";
            let method = "GET";
            let headers = {};
            let body = "";

            try {
                if (typeof resource === 'string') {
                    url = resource;
                } else if (resource instanceof URL) {
                    url = resource.toString();
                } else if (resource && typeof resource === 'object') {
                    url = resource.url;
                    method = resource.method || "GET";
                    if (resource.headers) headers = resource.headers;
                }

                if (config) {
                    if (config.method) method = config.method;
                    if (config.headers) headers = config.headers;
                    if (config.body) {
                        if (typeof config.body === 'string') {
                            body = config.body;
                        } else if (config.body instanceof URLSearchParams) {
                            body = config.body.toString();
                        } else if (config.body instanceof FormData) {
                            const params = {};
                            for (const [k, v] of config.body.entries()) {
                                if (typeof v === 'string') params[k] = v;
                            }
                            body = new URLSearchParams(params).toString();
                        } else {
                            try {
                                body = JSON.stringify(config.body);
                            } catch {}
                        }
                    }
                }

                // If body is in the request object (not config), read asynchronously
                // without blocking the actual network call
                if (!body && resource && typeof resource === 'object' && resource.body) {
                    resource.clone().text().then(text => {
                        sendRequestLog(url, method, headers, text);
                    }).catch(() => {
                        sendRequestLog(url, method, headers, '');
                    });
                } else {
                    sendRequestLog(url, method, headers, body);
                }
            } catch (e) {
                // Interceptor safety fallback
            }

            return originalFetch.apply(this, arguments);
        };
    }

    // 2. Intercept XMLHttpRequest
    if (window.XMLHttpRequest) {
        const XHR = window.XMLHttpRequest.prototype;
        const originalOpen = XHR.open;
        const originalSend = XHR.send;
        const originalSetRequestHeader = XHR.setRequestHeader;

        XHR.open = function(method, url) {
            this._method = method;
            this._url = url;
            this._headers = {};
            return originalOpen.apply(this, arguments);
        };

        XHR.setRequestHeader = function(header, value) {
            if (!this._headers) this._headers = {};
            this._headers[header] = value;
            return originalSetRequestHeader.apply(this, arguments);
        };

        XHR.send = function(postData) {
            this.addEventListener('load', () => {
                try {
                    let body = "";
                    if (postData) {
                        if (typeof postData === 'string') {
                            body = postData;
                        } else if (postData instanceof URLSearchParams) {
                            body = postData.toString();
                        } else if (postData instanceof FormData) {
                            const params = {};
                            for (const [k, v] of postData.entries()) {
                                if (typeof v === 'string') params[k] = v;
                            }
                            body = new URLSearchParams(params).toString();
                        } else {
                            try {
                                body = JSON.stringify(postData);
                            } catch {}
                        }
                    }
                    sendRequestLog(this._url, this._method, this._headers, body);
                } catch (e) {}
            });
            return originalSend.apply(this, arguments);
        };
    }

    // 3. Intercept standard HTML Form submissions
    window.addEventListener('submit', (e) => {
        try {
            const form = e.target;
            if (!form || form.tagName.toLowerCase() !== 'form') return;

            const url = form.action || window.location.href;
            const method = (form.method || 'GET').toUpperCase();
            
            // Do not intercept if form submission is prevented or handled by JS (which will trigger fetch/XHR)
            // But we can check after a tiny delay or just log it anyway (redundancies are merged in background.js)
            const formData = new FormData(form);
            const bodyParams = {};
            formData.forEach((value, key) => {
                if (typeof value === 'string') {
                    bodyParams[key] = value;
                }
            });

            const contentType = form.enctype || 'application/x-www-form-urlencoded';
            let body = "";
            if (contentType === 'multipart/form-data') {
                body = new URLSearchParams(bodyParams).toString(); // Fallback representation
            } else {
                body = new URLSearchParams(bodyParams).toString();
            }

            sendRequestLog(url, method, { 'Content-Type': contentType }, body);
        } catch (err) {}
    }, true);

    // 4. Expose sync endpoint helper for dashboard auto-sync
    // If the dashboard wants to push authentication updates, it can dispatch a custom event
    window.addEventListener('swazz-handshake', (e) => {
        if (e.detail && e.detail.token) {
            window.postMessage({
                source: 'swazz-detector',
                type: 'auth_sync',
                data: {
                    token: e.detail.token,
                    userProfile: e.detail.userProfile || null
                }
            }, '*');
        }
    });
})();
