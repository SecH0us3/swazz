(function() {
    // Prevent double injection
    if (window.__swazz_intercept_loaded) return;
    window.__swazz_intercept_loaded = true;

    let nextRequestId = 1;

    function formatHeaders(headers) {
        const result = {};
        if (!headers) return result;
        if (headers instanceof Headers) {
            for (const [key, value] of headers.entries()) {
                result[key.toLowerCase()] = value;
            }
        } else if (Array.isArray(headers)) {
            headers.forEach(([key, value]) => {
                if (key) result[key.toLowerCase()] = value;
            });
        } else if (typeof headers === 'object') {
            for (const key of Object.keys(headers)) {
                result[key.toLowerCase()] = headers[key];
            }
        }
        return result;
    }

    function sendRequestLog(url, method, headers, body, customReqId) {
        const reqId = customReqId || (nextRequestId++);
        try {
            // Absolute URL check
            const absoluteUrl = new URL(url, window.location.href).href;
            
            // Post message to isolated content script
            window.postMessage({
                source: 'swazz-detector',
                type: 'request',
                data: {
                    requestId: reqId,
                    url: absoluteUrl,
                    method: (method || 'GET').toUpperCase(),
                    headers: formatHeaders(headers),
                    body: body || ''
                }
            }, window.location.origin);
        } catch (e) {
            // Silently ignore URL parsing errors
        }
        return reqId;
    }

    function isTextualContentType(ct) {
        if (!ct) return true; // missing Content-Type is allowed
        const lower = ct.toLowerCase();
        return lower.startsWith('text/') ||
               lower.includes('json') ||
               lower.includes('xml') ||
               lower.includes('x-www-form-urlencoded');
    }

    function shouldCaptureResponseBody(headers) {
        let cl = null;
        let ct = null;
        if (typeof Headers !== 'undefined' && headers instanceof Headers) {
            cl = headers.get('content-length');
            ct = headers.get('content-type');
        } else if (headers && typeof headers === 'object') {
            for (const k of Object.keys(headers)) {
                const kl = k.toLowerCase();
                if (kl === 'content-length') cl = headers[k];
                else if (kl === 'content-type') ct = headers[k];
            }
        }
        if (cl) {
            const len = parseInt(cl, 10);
            if (!isNaN(len) && len > 64 * 1024) {
                return false;
            }
        }
        return isTextualContentType(ct);
    }

    function sendResponseLog(requestId, status, statusText, headers, bodyText) {
        if (!requestId) return;
        try {
            window.postMessage({
                source: 'swazz-detector',
                type: 'response',
                data: {
                    requestId: requestId,
                    status: typeof status === 'number' ? status : 0,
                    statusText: statusText || '',
                    headers: formatHeaders(headers),
                    bodyText: (bodyText || '').slice(0, 10000)
                }
            }, window.location.origin);
        } catch (e) {
            // Silently ignore
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
            const reqId = nextRequestId++;

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
                    // Register the request synchronously first: reading the body is
                    // async, and on a fast or cached response the response message
                    // would otherwise arrive before the request it belongs to and be
                    // dropped for having no pending entry.
                    sendRequestLog(url, method, headers, '', reqId);
                    try {
                        resource.clone().text().then(text => {
                            if (text) sendRequestLog(url, method, headers, text, reqId);
                        }).catch(() => {});
                    } catch (e) {}
                } else {
                    sendRequestLog(url, method, headers, body, reqId);
                }
            } catch (e) {
                // Interceptor safety fallback
            }

            const fetchPromise = originalFetch.apply(this, arguments);
            fetchPromise.then(res => {
                try {
                    const status = res.status;
                    const statusText = res.statusText;
                    const resHeaders = formatHeaders(res.headers);
                    if (shouldCaptureResponseBody(res.headers)) {
                        const cloned = res.clone();
                        cloned.text().then(text => {
                            sendResponseLog(reqId, status, statusText, resHeaders, text);
                        }).catch(() => {
                            sendResponseLog(reqId, status, statusText, resHeaders, '');
                        });
                    } else {
                        sendResponseLog(reqId, status, statusText, resHeaders, '');
                    }
                } catch (e) {}
            }).catch(() => {});

            return fetchPromise;
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
            if (!this._swazzListenerAttached) {
                this._swazzListenerAttached = true;
                this.addEventListener('loadend', function() {
                    try {
                        if (!this._swazzReqId) return;
                        const status = this.status;
                        const statusText = this.statusText;
                        const rawHeaders = this.getAllResponseHeaders() || '';
                        const headers = {};
                        rawHeaders.split('\r\n').forEach(line => {
                            const parts = line.split(': ');
                            if (parts.length >= 2) {
                                const k = parts.shift().trim();
                                headers[k.toLowerCase()] = parts.join(': ').trim();
                            }
                        });
                        let bodyText = '';
                        if (shouldCaptureResponseBody(headers)) {
                            const rt = this.responseType;
                            if (rt === '' || rt === 'text') {
                                bodyText = this.responseText || '';
                            } else if (rt === 'json') {
                                try {
                                    bodyText = typeof this.response === 'string' ? this.response : JSON.stringify(this.response);
                                } catch (e) {}
                            }
                        }
                        sendResponseLog(this._swazzReqId, status, statusText, headers, bodyText);
                        this._swazzReqId = null;
                    } catch (e) {}
                });
            }
            return originalOpen.apply(this, arguments);
        };

        XHR.setRequestHeader = function(header, value) {
            if (!this._headers) this._headers = {};
            this._headers[header] = value;
            return originalSetRequestHeader.apply(this, arguments);
        };

        XHR.send = function(postData) {
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
                const reqId = sendRequestLog(this._url, this._method, this._headers, body);
                this._swazzReqId = reqId;
            } catch (e) {}
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
                body = new URLSearchParams(bodyParams).toString();
            } else {
                body = new URLSearchParams(bodyParams).toString();
            }

            sendRequestLog(url, method, { 'Content-Type': contentType }, body);
        } catch (err) {}
    }, true);

    // 4. Intercept navigator.sendBeacon (B4)
    if (navigator.sendBeacon) {
        const originalSendBeacon = navigator.sendBeacon;
        navigator.sendBeacon = function(url, data) {
            try {
                let body = "";
                let headers = {};
                if (typeof data === 'string') {
                    body = data;
                    headers = { 'content-type': 'text/plain;charset=UTF-8' };
                } else if (data instanceof Blob) {
                    headers = { 'content-type': data.type || 'application/octet-stream' };
                } else if (data instanceof FormData) {
                    const params = {};
                    for (const [k, v] of data.entries()) {
                        if (typeof v === 'string') params[k] = v;
                    }
                    body = new URLSearchParams(params).toString();
                    headers = { 'content-type': 'application/x-www-form-urlencoded' };
                } else if (data instanceof URLSearchParams) {
                    body = data.toString();
                    headers = { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' };
                }
                sendRequestLog(url, 'POST', headers, body);
            } catch (e) {}
            return originalSendBeacon.apply(this, arguments);
        };
    }
})();
