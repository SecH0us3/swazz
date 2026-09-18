/**
 * Swazz Traffic Capturer - HAR Module
 * Handles HAR 1.2 generation, download, parsing and path normalization.
 */
(function (root, factory) {
    if (typeof exports === 'object' && typeof module !== 'undefined') {
        module.exports = factory();
    } else {
        root.SwazzHar = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {

    /**
     * Normalizes paths by replacing UUIDs, ULIDs, and numeric path segments with placeholders.
     * Shared between background service worker and popup.
     */
    function normalizePath(path) {
        if (!path) return '/';
        let clean = path;
        // Replace typical UUIDs
        clean = clean.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '{uuid}');
        // Replace typical ULIDs. Crockford Base32 is 0-9 and A-Z minus I, L, O and
        // U — the class must include B through H, or a real ULID containing any of
        // them (over 99% of them) is never collapsed and every id becomes its own
        // capture key.
        clean = clean.replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/gi, '{ulid}');
        // Replace numeric IDs (longer than 1 digit, or segment matches exactly a number)
        const segments = clean.split('/');
        for (let i = 0; i < segments.length; i++) {
            if (/^\d+$/.test(segments[i]) && segments[i].length > 0) {
                segments[i] = '{id}';
            }
        }
        return segments.join('/');
    }

    /**
     * Builds standard HAR log structure from captured requests map.
     * Expands entries by query variations and body variations.
     * Emits real response data if available.
     */
    function buildHarPayload(requestsMap) {
        const entries = [];
        const keys = Object.keys(requestsMap || {});

        keys.forEach(k => {
            const req = requestsMap[k];
            if (!req || !req.exampleUrl) return;

            try {
                const urlObj = new URL(req.exampleUrl);

                // Map headers
                const headerItems = Object.entries(req.headers || {}).map(([name, value]) => ({
                    name,
                    value: String(value)
                }));

                // Content type fallback
                let reqMimeType = "application/json";
                if (req.headers) {
                    const ctKey = Object.keys(req.headers).find(h => h.toLowerCase() === 'content-type');
                    if (ctKey && req.headers[ctKey]) {
                        reqMimeType = req.headers[ctKey];
                    }
                }

                // Generate entries for each unique body or query variation captured
                const bodyList = (req.bodyVariations && req.bodyVariations.length > 0) ? req.bodyVariations : [""];
                const queryList = (req.queryVariations && req.queryVariations.length > 0) ? req.queryVariations : [urlObj.search];

                // Response data
                const lastResp = req.lastResponse || null;
                const respStatus = (lastResp && typeof lastResp.status === 'number') ? lastResp.status : 200;
                const respStatusText = (lastResp && lastResp.statusText) ? lastResp.statusText : (respStatus === 200 ? "OK" : "");
                
                let respHeaders = [];
                let respMimeType = "application/json";
                let respBodyText = (lastResp && lastResp.bodySample) ? lastResp.bodySample : "";

                if (lastResp && lastResp.headers) {
                    if (Array.isArray(lastResp.headers)) {
                        respHeaders = lastResp.headers.map(h => ({ name: h.name, value: String(h.value) }));
                        const ct = respHeaders.find(h => h.name.toLowerCase() === 'content-type');
                        if (ct) respMimeType = ct.value;
                    } else if (typeof lastResp.headers === 'object') {
                        respHeaders = Object.entries(lastResp.headers).map(([name, value]) => ({
                            name,
                            value: String(value)
                        }));
                        const ctKey = Object.keys(lastResp.headers).find(h => h.toLowerCase() === 'content-type');
                        if (ctKey && lastResp.headers[ctKey]) respMimeType = lastResp.headers[ctKey];
                    }
                }

                queryList.forEach(q => {
                    bodyList.forEach(b => {
                        const variantUrl = new URL(urlObj.origin + urlObj.pathname + q);
                        const vQueryParams = [];
                        variantUrl.searchParams.forEach((val, name) => {
                            vQueryParams.push({ name, value: val });
                        });

                        const postData = b ? {
                            mimeType: reqMimeType,
                            text: b
                        } : undefined;

                        const contentObj = {
                            size: respBodyText ? respBodyText.length : 0,
                            mimeType: respMimeType
                        };
                        if (respBodyText) {
                            contentObj.text = respBodyText;
                        }

                        entries.push({
                            // HAR permits custom fields prefixed with an underscore.
                            // Entries fan out across query x body variations, so the
                            // observed status counts cannot be recovered by counting
                            // entries on import — carry the real ones here.
                            _swazz: {
                                endpointKey: req.key,
                                statuses: Object.assign({}, req.statuses || {}),
                                count: req.count || 0
                            },
                            startedDateTime: new Date(req.lastCaptured || Date.now()).toISOString(),
                            time: 10,
                            request: {
                                method: req.method,
                                url: variantUrl.href,
                                httpVersion: "HTTP/1.1",
                                cookies: [],
                                headers: headerItems,
                                queryString: vQueryParams,
                                postData: postData,
                                headersSize: -1,
                                bodySize: b ? b.length : -1
                            },
                            response: {
                                status: respStatus,
                                statusText: respStatusText,
                                httpVersion: "HTTP/1.1",
                                cookies: [],
                                headers: respHeaders,
                                content: contentObj,
                                redirectURL: "",
                                headersSize: -1,
                                bodySize: respBodyText ? respBodyText.length : -1
                            },
                            cache: {},
                            timings: { send: 0, wait: 10, receive: 0 }
                        });
                    });
                });
            } catch (e) {
                console.error("Skipping malformed URL during HAR generation:", req.exampleUrl, e);
            }
        });

        return {
            log: {
                version: "1.2",
                creator: {
                    name: "Swazz Extension Capturer",
                    version: "1.0.0"
                },
                entries: entries
            }
        };
    }

    /**
     * Triggers download of HAR file for the given requests map and target domains.
     * Uses an anchor download trick to avoid needing the 'downloads' permission.
     */
    function downloadHar(requestsMap, targetDomains) {
        const payload = buildHarPayload(requestsMap);
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });

        let primaryDomain = 'capture';
        if (targetDomains && targetDomains.length > 0 && targetDomains[0]) {
            primaryDomain = targetDomains[0].replace(/[:/]/g, '-');
        }

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const yyyy = now.getFullYear();
        const mm = pad(now.getMonth() + 1);
        const dd = pad(now.getDate());
        const hh = pad(now.getHours());
        const min = pad(now.getMinutes());
        const ss = pad(now.getSeconds());
        const timestamp = `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
        const filename = `swazz-${primaryDomain}-${timestamp}.har`;

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 10000);

        return {
            entries: payload.log.entries.length,
            filename: filename
        };
    }

    /**
     * Parses a HAR JSON string or object back into the capturedRequests map shape.
     */
    function parseHarIntoRequests(harJson) {
        let parsed;
        if (typeof harJson === 'string') {
            try {
                parsed = JSON.parse(harJson);
            } catch (e) {
                throw new Error("Invalid JSON: could not parse HAR file");
            }
        } else if (harJson && typeof harJson === 'object') {
            parsed = harJson;
        } else {
            throw new Error("Invalid HAR data: expected JSON string or object");
        }

        if (!parsed || !parsed.log || !Array.isArray(parsed.log.entries)) {
            throw new Error("Invalid HAR format: missing log.entries array");
        }

        const requestsMap = {};

        parsed.log.entries.forEach(entry => {
            if (!entry || !entry.request || !entry.request.url) return;

            const req = entry.request;
            let parsedUrl;
            try {
                parsedUrl = new URL(req.url);
            } catch (e) {
                return;
            }

            const method = (req.method || 'GET').toUpperCase();
            const path = parsedUrl.pathname || '/';
            const normalized = normalizePath(path);
            const key = `${method}:${normalized}`;

            const headers = {};
            if (Array.isArray(req.headers)) {
                req.headers.forEach(h => {
                    if (h && h.name) headers[h.name] = h.value;
                });
            } else if (req.headers && typeof req.headers === 'object') {
                Object.assign(headers, req.headers);
            }

            let existing = requestsMap[key];
            if (!existing) {
                existing = {
                    key,
                    method,
                    path: normalized,
                    exampleUrl: req.url,
                    headers,
                    count: 0,
                    lastCaptured: 0,
                    queryKeys: [],
                    queryVariations: [],
                    bodyVariations: [],
                    recommendation: "",
                    status: "needs_work",
                    statuses: {}
                };
                requestsMap[key] = existing;
            }

            // Entries fan out across query x body variations, so counting them
            // would report the fan-out rather than the traffic. Our own export
            // carries the true figure.
            const stampedCount = entry._swazz && typeof entry._swazz.count === 'number'
                ? entry._swazz.count
                : null;
            if (stampedCount !== null && stampedCount > 0) {
                existing.count = stampedCount;
            } else {
                existing.count += 1;
            }
            const entryTime = entry.startedDateTime ? Date.parse(entry.startedDateTime) : 0;
            if (entryTime && entryTime > existing.lastCaptured) {
                existing.lastCaptured = entryTime;
                existing.exampleUrl = req.url;
            } else if (!existing.lastCaptured) {
                existing.lastCaptured = Date.now();
            }

            // Extract query parameters
            parsedUrl.searchParams.forEach((val, name) => {
                if (!existing.queryKeys.includes(name)) {
                    existing.queryKeys.push(name);
                }
            });
            if (Array.isArray(req.queryString)) {
                req.queryString.forEach(qp => {
                    if (qp && qp.name && !existing.queryKeys.includes(qp.name)) {
                        existing.queryKeys.push(qp.name);
                    }
                });
            }

            // Extract query variations
            const queryStr = parsedUrl.search;
            if (queryStr && !existing.queryVariations.includes(queryStr) && existing.queryVariations.length < 20) {
                existing.queryVariations.push(queryStr);
            }

            // Extract body variations
            const bodyStr = req.postData && req.postData.text ? req.postData.text.trim() : "";
            if (bodyStr && bodyStr.length < 10000) {
                if (!existing.bodyVariations.includes(bodyStr) && existing.bodyVariations.length < 10) {
                    existing.bodyVariations.push(bodyStr);
                }
            }

            // Extract response status and sample
            if (entry.response) {
                const resp = entry.response;
                if (typeof resp.status === 'number' && resp.status > 0) {
                    const stamped = entry._swazz && entry._swazz.statuses;
                    if (stamped && Object.keys(stamped).length > 0) {
                        // Our own export: adopt the recorded counts verbatim, once.
                        existing.statuses = Object.assign({}, stamped);
                    } else {
                        const sKey = String(resp.status);
                        existing.statuses[sKey] = (existing.statuses[sKey] || 0) + 1;
                    }

                    const respHeaders = {};
                    if (Array.isArray(resp.headers)) {
                        resp.headers.forEach(h => {
                            if (h && h.name) respHeaders[h.name.toLowerCase()] = h.value;
                        });
                    }
                    existing.lastResponse = {
                        status: resp.status,
                        statusText: resp.statusText || "",
                        headers: respHeaders,
                        bodySample: (resp.content && resp.content.text) ? resp.content.text.slice(0, 10000) : ""
                    };
                }
            }

            // Calculate coverage recommendations
            const uniqueQueryCount = existing.queryVariations.length;
            const uniqueBodyCount = existing.bodyVariations.length;
            const totalVariations = uniqueQueryCount + uniqueBodyCount;
            const hasInputs = existing.queryKeys.length > 0 || uniqueBodyCount > 0;

            if (!hasInputs) {
                existing.recommendation = "ℹ️ Static endpoint. No input parameters detected.";
                existing.status = "well_covered";
            } else if (existing.queryKeys.length > 0 && uniqueQueryCount < 2) {
                existing.recommendation = `💡 Tip: Try requesting this endpoint with a different query string (currently captured ${uniqueQueryCount} variation).`;
                existing.status = "needs_work";
            } else if (uniqueBodyCount > 0 && uniqueBodyCount < 2) {
                existing.recommendation = `💡 Tip: Resubmit this API request/form with different field inputs (currently captured ${uniqueBodyCount} variation).`;
                existing.status = "needs_work";
            } else {
                existing.recommendation = `✅ Excellent coverage! Multiple dynamic parameter variations recorded (${totalVariations} total).`;
                existing.status = "well_covered";
            }
        });

        return requestsMap;
    }

    /**
     * Merges an incoming requests map into an existing requests map.
     * Computes the union of variations and sums counts.
     */
    function mergeCapturedRequests(existingMap, incomingMap) {
        const merged = Object.assign({}, existingMap);
        for (const key of Object.keys(incomingMap || {})) {
            const incoming = incomingMap[key];
            if (!merged[key]) {
                merged[key] = JSON.parse(JSON.stringify(incoming));
            } else {
                // Deep-copy before mutating: callers pass their live state in as
                // existingMap and this function reads as pure.
                const cur = JSON.parse(JSON.stringify(merged[key]));
                merged[key] = cur;
                cur.queryKeys = cur.queryKeys || [];
                cur.queryVariations = cur.queryVariations || [];
                cur.bodyVariations = cur.bodyVariations || [];
                cur.count = (cur.count || 0) + (incoming.count || 0);
                cur.lastCaptured = Math.max(cur.lastCaptured || 0, incoming.lastCaptured || 0);
                if (incoming.exampleUrl && !cur.exampleUrl) cur.exampleUrl = incoming.exampleUrl;
                cur.headers = Object.assign({}, incoming.headers, cur.headers);

                (incoming.queryKeys || []).forEach(qk => {
                    if (!cur.queryKeys.includes(qk)) cur.queryKeys.push(qk);
                });
                (incoming.queryVariations || []).forEach(qv => {
                    if (!cur.queryVariations.includes(qv) && cur.queryVariations.length < 20) {
                        cur.queryVariations.push(qv);
                    }
                });
                (incoming.bodyVariations || []).forEach(bv => {
                    if (!cur.bodyVariations.includes(bv) && cur.bodyVariations.length < 10) {
                        cur.bodyVariations.push(bv);
                    }
                });

                cur.statuses = cur.statuses || {};
                if (incoming.statuses) {
                    for (const s of Object.keys(incoming.statuses)) {
                        cur.statuses[s] = (cur.statuses[s] || 0) + incoming.statuses[s];
                    }
                }
                if (incoming.lastResponse && (!cur.lastResponse || (incoming.lastCaptured >= (cur.lastCaptured || 0)))) {
                    cur.lastResponse = incoming.lastResponse;
                }

                const uniqueQueryCount = cur.queryVariations.length;
                const uniqueBodyCount = cur.bodyVariations.length;
                const totalVariations = uniqueQueryCount + uniqueBodyCount;
                const hasInputs = cur.queryKeys.length > 0 || uniqueBodyCount > 0;

                if (!hasInputs) {
                    cur.recommendation = "ℹ️ Static endpoint. No input parameters detected.";
                    cur.status = "well_covered";
                } else if (cur.queryKeys.length > 0 && uniqueQueryCount < 2) {
                    cur.recommendation = `💡 Tip: Try requesting this endpoint with a different query string (currently captured ${uniqueQueryCount} variation).`;
                    cur.status = "needs_work";
                } else if (uniqueBodyCount > 0 && uniqueBodyCount < 2) {
                    cur.recommendation = `💡 Tip: Resubmit this API request/form with different field inputs (currently captured ${uniqueBodyCount} variation).`;
                    cur.status = "needs_work";
                } else {
                    cur.recommendation = `✅ Excellent coverage! Multiple dynamic parameter variations recorded (${totalVariations} total).`;
                    cur.status = "well_covered";
                }
            }
        }
        return merged;
    }

    return {
        normalizePath,
        buildHarPayload,
        downloadHar,
        parseHarIntoRequests,
        mergeCapturedRequests
    };
});
