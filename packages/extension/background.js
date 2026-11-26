if (typeof importScripts === 'function') {
    importScripts('config.js', 'har.js', 'scope.js');
}

const { normalizePath } = (typeof self !== 'undefined' && self.SwazzHar) || 
    (typeof require === 'function' ? require('./har.js') : (typeof window !== 'undefined' ? window.SwazzHar : {}));
const { stripPort, isDomainTargeted, isAuthOriginAllowed } = (typeof self !== 'undefined' && self.SwazzScope) || 
    (typeof require === 'function' ? require('./scope.js') : (typeof window !== 'undefined' ? window.SwazzScope : {}));

// Default state
const DEFAULT_STATE = {
    recording: false,
    targetDomains: [], // List of domain strings, e.g. ["localhost:8080", "example.com"]
    capturedRequests: {}, // Map of key -> request details
    droppedOutOfScope: 0,
    droppedNoScope: 0,
    lastDroppedHost: "",
    droppedHosts: {}, // host -> how many requests were ignored for being out of scope
    token: null,
    swazzUrl: (typeof self !== 'undefined' && self.SWAZZ_DEFAULT_URL) || "http://localhost:5173",
    projectId: null,
    projectName: "",
    userProfile: null
};

// Module-level in-memory state (B5)
let recording = false;
let targetDomains = [];
let capturedRequests = {};
let droppedOutOfScope = 0;
let droppedNoScope = 0;
let lastDroppedHost = "";
let droppedHosts = {};
let swazzUrl = DEFAULT_STATE.swazzUrl;

// Map from requestId -> { key, timestamp } for response correlation (B2)
const pendingRequests = new Map();
const countedRequests = new Set();
// Track redirect hops per Chrome webRequest.requestId so a POST -> 302 -> GET
// redirect chain gets distinct correlation IDs instead of colliding.
const wrHopMap = new Map();

// inject.js mints request ids from a per-document counter that restarts at 1,
// so the raw id collides across tabs and frames. Scope it by sender before
// using it to pair a response with its request.
// Out-of-scope traffic is summarised per host, not just as a running total, so
// the popup can show every domain that was ignored instead of only the last one.
function noteDroppedHost(host) {
    if (!host) return;
    const known = Object.keys(droppedHosts).length;
    if (!droppedHosts[host] && known >= 200) return; // bound the map
    droppedHosts[host] = (droppedHosts[host] || 0) + 1;
}

function correlationId(sender, requestId) {
    const tabId = sender && sender.tab && sender.tab.id != null ? sender.tab.id : 'x';
    const frameId = sender && sender.frameId != null ? sender.frameId : 'x';
    return tabId + ':' + frameId + ':' + requestId;
}

// Debounce storage flush state (B5).
// Writes carry a monotonically increasing token so the worker can tell its own
// echo from a genuine edit made elsewhere (the popup deleting an endpoint or
// importing a HAR). A timing window cannot: a popup write landing inside it was
// previously ignored and then overwritten by the next flush.
let flushTimer = null;
let writeToken = 0;

function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushStorage, 250);
}

function flushStorage() {
    flushTimer = null;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    writeToken += 1;
    chrome.storage.local.set({
        capturedRequests,
        droppedOutOfScope,
        droppedNoScope,
        lastDroppedHost,
        droppedHosts,
        captureWriteToken: writeToken
    });
}

function updateBadge() {
    if (typeof chrome === 'undefined' || !chrome.action) return;
    const count = Object.keys(capturedRequests).length;
    if (count > 0) {
        chrome.action.setBadgeText({ text: String(count) });
        chrome.action.setBadgeBackgroundColor({ color: recording ? '#ef4444' : '#6b7280' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// Initialize state in local storage if not present
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(() => {
        chrome.storage.local.get(Object.keys(DEFAULT_STATE), (result) => {
            const updates = {};
            for (const key in DEFAULT_STATE) {
                if (result[key] === undefined) {
                    updates[key] = DEFAULT_STATE[key];
                }
            }
            if (Object.keys(updates).length > 0) {
                chrome.storage.local.set(updates);
            }
        });
    });
}

// Hydrate module-level state on startup.
// An MV3 service worker is evicted after ~30s idle and restarts cold on the next
// event, with every variable back at its default. Reading storage is async, so a
// message arriving before that read completes would see recording === false and
// be dropped, and a capture written meanwhile would be clobbered by the callback.
// Everything that reads this state waits on hydrationPromise first.
let isHydrated = false;
let hydrationPromise = Promise.resolve();

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    hydrationPromise = new Promise((resolve) => {
        chrome.storage.local.get([
            'recording',
            'targetDomains',
            'capturedRequests',
            'droppedOutOfScope',
            'droppedNoScope',
            'lastDroppedHost',
            'droppedHosts',
            'swazzUrl'
        ], (state) => {
            if (state) {
                recording = !!state.recording;
                targetDomains = state.targetDomains || [];
                capturedRequests = state.capturedRequests || {};
                droppedOutOfScope = state.droppedOutOfScope || 0;
                droppedNoScope = state.droppedNoScope || 0;
                lastDroppedHost = state.lastDroppedHost || "";
                droppedHosts = state.droppedHosts || {};
                swazzUrl = state.swazzUrl || DEFAULT_STATE.swazzUrl;
            }
            isHydrated = true;
            updateBadge();
            resolve();
        });
    });
} else {
    isHydrated = true;
}

function whenHydrated(fn) {
    if (isHydrated) return fn();
    return hydrationPromise.then(fn);
}

// Re-hydrate on storage changes not originating from our own flush
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        if (changes.recording) {
            recording = !!changes.recording.newValue;
            updateBadge();
        }
        if (changes.targetDomains) {
            targetDomains = changes.targetDomains.newValue || [];
        }
        if (changes.swazzUrl) {
            swazzUrl = changes.swazzUrl.newValue || DEFAULT_STATE.swazzUrl;
        }
        // Our own flush stamps captureWriteToken with the value we last wrote;
        // anything else is an edit from the popup and must be adopted.
        const stampedByUs = changes.captureWriteToken &&
            changes.captureWriteToken.newValue === writeToken;
        const isForeignEdit = !stampedByUs;

        if (changes.capturedRequests && isForeignEdit) {
            capturedRequests = changes.capturedRequests.newValue || {};
            updateBadge();
        }
        if (changes.droppedOutOfScope && isForeignEdit) {
            droppedOutOfScope = changes.droppedOutOfScope.newValue || 0;
        }
        if (changes.droppedNoScope && isForeignEdit) {
            droppedNoScope = changes.droppedNoScope.newValue || 0;
        }
        if (changes.lastDroppedHost && isForeignEdit) {
            lastDroppedHost = changes.lastDroppedHost.newValue || "";
        }
        if (changes.droppedHosts && isForeignEdit) {
            droppedHosts = changes.droppedHosts.newValue || {};
        }
    });
}

function isSwazzDashboardHost(host) {
    if (!host) return false;
    const lowerHost = String(host).trim().toLowerCase();
    if (lowerHost === 'localhost:5173') return true;
    if (typeof isAuthOriginAllowed === 'function' && isAuthOriginAllowed('https://' + lowerHost)) {
        return true;
    }
    if (swazzUrl) {
        try {
            const parsed = new URL(swazzUrl);
            if (parsed.host && lowerHost === parsed.host.toLowerCase()) {
                return true;
            }
        } catch (e) {}
    }
    return false;
}

function processCapturedRequest(reqData, senderTab, sender) {
    if (!recording) return;

    let parsedUrl;
    try {
        parsedUrl = new URL(reqData.url);
    } catch (e) {
        return;
    }
    const host = parsedUrl.host;

    // Scope filter as primary gate (B1 & B5)
    if (!targetDomains || targetDomains.length === 0) {
        droppedNoScope++;
        scheduleFlush();
        return;
    }

    const isWebMcp = parsedUrl.protocol === 'webmcp:';
    if (isWebMcp) {
        let senderHost = null;
        if (senderTab && senderTab.url) {
            try {
                senderHost = new URL(senderTab.url).host;
            } catch (e) {}
        }
        if (!senderHost || !isDomainTargeted(senderHost, targetDomains)) {
            droppedOutOfScope++;
            if (senderHost) {
                lastDroppedHost = senderHost;
                noteDroppedHost(senderHost);
            }
            scheduleFlush();
            return;
        }
    } else if (!isDomainTargeted(host, targetDomains)) {
        // Do not pollute Ignored / warning banner with traffic from the Swazz
        // Dashboard itself (e.g. scan polling on swazz.secmy.app or localhost:5173).
        if (isSwazzDashboardHost(host)) {
            return;
        }
        droppedOutOfScope++;
        lastDroppedHost = host;
        noteDroppedHost(host);
        scheduleFlush();
        return;
    }

    // Validate sender tab url if present (unparseable tab URL is dropped)
    if (senderTab && senderTab.url) {
        try {
            new URL(senderTab.url);
        } catch (e) {
            return; // Drop on unparseable sender.tab.url
        }
    }

    const method = (reqData.method || 'GET').toUpperCase();
    const path = isWebMcp ? reqData.url : (parsedUrl.pathname || '/');
    const normalized = isWebMcp ? reqData.url : normalizePath(path);

    // Key is Method + Host + Normalized Path (so different sites with /login never collide)
    const key = isWebMcp ? `${method}:${normalized}` : `${method}:${host}${normalized}`;

    // Exclude common noise assets
    if (!isWebMcp) {
        const fileExtension = path.split('.').pop().toLowerCase();
        const ignoredExtensions = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'map'];
        if (ignoredExtensions.includes(fileExtension)) return;
    }

    let existing = capturedRequests[key];
    if (!existing) {
        existing = {
            key,
            method,
            host: isWebMcp ? '' : host,
            path: normalized,
            exampleUrl: reqData.url,
            headers: reqData.headers || {},
            count: 0,
            lastCaptured: Date.now(),
            queryKeys: [],
            queryVariations: [],
            bodyVariations: [],
            recommendation: "",
            status: "needs_work",
            statuses: {}
        };
        capturedRequests[key] = existing;
    }

    // inject.js may report the same request twice: once synchronously and again
    // once its body has been read. Count the request once, but let the second
    // message contribute the body it carries.
    const corrId = reqData.requestId ? correlationId(sender, reqData.requestId) : null;
    const alreadyCounted = corrId ? countedRequests.has(corrId) : false;
    if (!alreadyCounted) {
        existing.count += 1;
        if (corrId) {
            countedRequests.add(corrId);
            if (countedRequests.size > 5000) {
                countedRequests.clear();
            }
        }
    }
    existing.lastCaptured = Date.now();
    existing.exampleUrl = reqData.url;
    if (reqData.headers && Object.keys(reqData.headers).length > 0) {
        existing.headers = Object.assign({}, existing.headers, reqData.headers);
    }

    // Track query keys
    parsedUrl.searchParams.forEach((value, name) => {
        if (!existing.queryKeys.includes(name)) {
            existing.queryKeys.push(name);
        }
    });

    // Track unique query string values (max 20 variations)
    const queryStringStr = parsedUrl.search;
    if (queryStringStr && !existing.queryVariations.includes(queryStringStr) && existing.queryVariations.length < 20) {
        existing.queryVariations.push(queryStringStr);
    }

    // Track unique body payloads (max 10 variations, max 10KB each)
    const bodyStr = reqData.body ? reqData.body.trim() : "";
    if (bodyStr && bodyStr.length < 10000) {
        if (!existing.bodyVariations.includes(bodyStr) && existing.bodyVariations.length < 10) {
            existing.bodyVariations.push(bodyStr);
        }
    }

    // Generate recommendations based on coverage
    let recommendation = "";
    let status = "needs_work";

    const hasInputs = existing.queryKeys.length > 0 || bodyStr.length > 0;
    if (!hasInputs) {
        recommendation = "ℹ️ Static endpoint. No input parameters detected.";
        status = "well_covered";
    } else {
        const uniqueQueryCount = existing.queryVariations.length;
        const uniqueBodyCount = existing.bodyVariations.length;
        const totalVariations = uniqueQueryCount + uniqueBodyCount;

        if (existing.queryKeys.length > 0 && uniqueQueryCount < 2) {
            recommendation = `💡 Tip: Try requesting this endpoint with a different query string (currently captured ${uniqueQueryCount} variation).`;
            status = "needs_work";
        } else if (bodyStr.length > 0 && uniqueBodyCount < 2) {
            recommendation = `💡 Tip: Resubmit this API request/form with different field inputs (currently captured ${uniqueBodyCount} variation).`;
            status = "needs_work";
        } else {
            recommendation = `✅ Excellent coverage! Multiple dynamic parameter variations recorded (${totalVariations} total).`;
            status = "well_covered";
        }
    }

    existing.recommendation = recommendation;
    existing.status = status;

    // Track requestId for response correlation (B2)
    if (reqData.requestId) {
        pendingRequests.set(correlationId(sender, reqData.requestId), { key, timestamp: Date.now() });
        if (pendingRequests.size > 2000) {
            const cutoff = Date.now() - 60000;
            for (const [id, item] of pendingRequests.entries()) {
                if (item.timestamp < cutoff) pendingRequests.delete(id);
            }
        }
    }

    updateBadge();
    scheduleFlush();
}

function processCapturedResponse(resData, sender) {
    if (!recording || !resData || !resData.requestId) return;

    const corrId = correlationId(sender, resData.requestId);
    const pending = pendingRequests.get(corrId);
    if (!pending) return;
    pendingRequests.delete(corrId);

    const existing = capturedRequests[pending.key];
    if (!existing) return;

    const status = resData.status || 0;
    if (status > 0) {
        const statusKey = String(status);
        existing.statuses = existing.statuses || {};
        existing.statuses[statusKey] = (existing.statuses[statusKey] || 0) + 1;
    }

    existing.lastResponse = {
        status: status,
        statusText: resData.statusText || '',
        headers: resData.headers || {},
        bodySample: (resData.bodyText || '').slice(0, 10000)
    };

    scheduleFlush();
}

function extractWebRequestBody(requestBody) {
    if (!requestBody) return { body: '', contentType: '' };
    if (requestBody.formData && typeof requestBody.formData === 'object') {
        const params = new URLSearchParams();
        for (const [key, values] of Object.entries(requestBody.formData)) {
            if (Array.isArray(values)) {
                for (const v of values) {
                    params.append(key, String(v));
                }
            } else if (values !== undefined && values !== null) {
                params.append(key, String(values));
            }
        }
        return {
            body: params.toString(),
            contentType: 'application/x-www-form-urlencoded'
        };
    }
    if (Array.isArray(requestBody.raw) && requestBody.raw.length > 0) {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let body = '';
        for (const chunk of requestBody.raw) {
            if (!chunk || !chunk.bytes) continue;
            try {
                const view = chunk.bytes instanceof Uint8Array
                    ? chunk.bytes
                    : new Uint8Array(chunk.bytes);
                body += decoder.decode(view, { stream: true });
                if (body.length >= 10000) {
                    body = body.slice(0, 10000);
                    break;
                }
            } catch (e) {}
        }
        body += decoder.decode();
        return { body: body.slice(0, 10000), contentType: '' };
    }
    return { body: '', contentType: '' };
}

function formatWebRequestHeaders(headerList, { skipCookie = false } = {}) {
    const result = {};
    if (!Array.isArray(headerList)) return result;
    for (const h of headerList) {
        if (!h || !h.name) continue;
        const name = h.name.toLowerCase();
        if (skipCookie && name === 'cookie') continue;
        result[name] = h.value != null ? String(h.value) : '';
    }
    return result;
}

function handleWebRequestBeforeRequest(details) {
    if (!details || !details.url || !details.url.startsWith('http')) return;
    const method = (details.method || 'GET').toUpperCase();
    // For sub_frame, only capture non-GET/HEAD requests (e.g. iframe form POSTs)
    // to avoid noisy third-party iframe GETs.
    if (details.type === 'sub_frame' && (method === 'GET' || method === 'HEAD')) return;

    const hop = (wrHopMap.get(details.requestId) || 0) + 1;
    wrHopMap.set(details.requestId, hop);
    if (wrHopMap.size > 2000) {
        const oldestKey = wrHopMap.keys().next().value;
        if (oldestKey !== undefined) wrHopMap.delete(oldestKey);
    }

    const wrReqId = `wr:${details.requestId}:${hop}`;
    const wrSender = { tab: { id: details.tabId }, frameId: details.frameId };
    const { body, contentType } = extractWebRequestBody(details.requestBody);
    const headers = contentType ? { 'content-type': contentType } : {};

    return whenHydrated(() => processCapturedRequest({
        url: details.url,
        method,
        headers,
        body,
        requestId: wrReqId
    }, null, wrSender));
}

function handleWebRequestSendHeaders(details) {
    if (!details || !details.requestId) return;
    const hop = wrHopMap.get(details.requestId);
    if (!hop) return;

    const wrReqId = `wr:${details.requestId}:${hop}`;
    const wrSender = { tab: { id: details.tabId }, frameId: details.frameId };
    const allHeaders = formatWebRequestHeaders(details.requestHeaders, { skipCookie: true });
    const filteredHeaders = {};
    for (const [k, v] of Object.entries(allHeaders)) {
        if (k === 'content-type' || k === 'accept' || k === 'authorization' || k.startsWith('x-')) {
            filteredHeaders[k] = v;
        }
    }
    if (Object.keys(filteredHeaders).length === 0) return;

    return whenHydrated(() => {
        const pending = pendingRequests.get(correlationId(wrSender, wrReqId));
        if (!pending) return;
        const existing = capturedRequests[pending.key];
        if (!existing) return;
        existing.headers = Object.assign({}, existing.headers, filteredHeaders);
        scheduleFlush();
    });
}

function handleWebRequestResponse(details, isFinal) {
    if (!details || !details.requestId) return;
    const hop = wrHopMap.get(details.requestId);
    if (!hop) return;

    const wrReqId = `wr:${details.requestId}:${hop}`;
    const wrSender = { tab: { id: details.tabId }, frameId: details.frameId };
    const respHeaders = formatWebRequestHeaders(details.responseHeaders);

    if (isFinal) {
        wrHopMap.delete(details.requestId);
    }

    return whenHydrated(() => processCapturedResponse({
        requestId: wrReqId,
        status: details.statusCode || 0,
        statusText: details.statusLine || '',
        headers: respHeaders,
        bodyText: ''
    }, wrSender));
}

function handleWebRequestError(details) {
    if (details && details.requestId) {
        wrHopMap.delete(details.requestId);
    }
}

// Capture top-level and iframe form navigations (including full-page POSTs)
// via chrome.webRequest so synchronous form submissions are never lost on unload.
if (typeof chrome !== 'undefined' && chrome.webRequest) {
    const navFilter = { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame'] };
    if (chrome.webRequest.onBeforeRequest) {
        chrome.webRequest.onBeforeRequest.addListener(handleWebRequestBeforeRequest, navFilter, ['requestBody']);
    }
    if (chrome.webRequest.onSendHeaders) {
        chrome.webRequest.onSendHeaders.addListener(handleWebRequestSendHeaders, navFilter, ['requestHeaders']);
    }
    if (chrome.webRequest.onBeforeRedirect) {
        chrome.webRequest.onBeforeRedirect.addListener((d) => handleWebRequestResponse(d, false), navFilter, ['responseHeaders']);
    }
    if (chrome.webRequest.onCompleted) {
        chrome.webRequest.onCompleted.addListener((d) => handleWebRequestResponse(d, true), navFilter, ['responseHeaders']);
    }
    if (chrome.webRequest.onErrorOccurred) {
        chrome.webRequest.onErrorOccurred.addListener(handleWebRequestError, navFilter);
    }
}

function handleRuntimeMessage(message, sender, sendResponse) {
    if (!message || message.source !== 'swazz-detector') return;

    if (message.type === 'auth_sync') {
        // B6: Validate sender tab origin against allowlist
        if (!sender || !sender.tab || !sender.tab.url) return;
        try {
            const senderUrl = new URL(sender.tab.url);
            const { token, userProfile, swazzUrl } = message.data || {};
            if (isAuthOriginAllowed(sender.tab.url) && swazzUrl === senderUrl.origin) {
                chrome.storage.local.set({ token, userProfile, swazzUrl });
            } else {
                console.warn('[Swazz Security] Rejected auth_sync from unverified origin:', senderUrl.origin, swazzUrl);
            }
        } catch (e) {}
        return;
    }

    if (message.type === 'get_my_tab_id') {
        if (sendResponse) sendResponse({ tabId: sender && sender.tab ? sender.tab.id : null });
        return;
    }

    if (message.type === 'request') {
        whenHydrated(() => processCapturedRequest(message.data, sender ? sender.tab : null, sender));
        return;
    }

    if (message.type === 'response') {
        whenHydrated(() => processCapturedResponse(message.data, sender));
        return;
    }
}

function handleTabRemoved(tabId) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(['crawlState'], (res) => {
        if (res && res.crawlState && res.crawlState.crawling && res.crawlState.tabId === tabId) {
            const nextCrawlState = Object.assign({}, res.crawlState, { crawling: false });
            chrome.storage.local.set({ crawlState: nextCrawlState });
        }
    });
}

if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
}

// Listen for messages from Content Script or Popup
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
}

// Export for unit tests in Node / Vitest
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        processCapturedRequest,
        processCapturedResponse,
        handleRuntimeMessage,
        handleTabRemoved,
        extractWebRequestBody,
        handleWebRequestBeforeRequest,
        handleWebRequestSendHeaders,
        handleWebRequestResponse,
        handleWebRequestError,
        getCapturedRequests: () => capturedRequests,
        setCapturedRequests: (val) => { capturedRequests = val; },
        getRecording: () => recording,
        setRecording: (val) => { recording = val; },
        getTargetDomains: () => targetDomains,
        setTargetDomains: (val) => { targetDomains = val; },
        setSwazzUrl: (val) => { swazzUrl = val || DEFAULT_STATE.swazzUrl; },
        getDroppedOutOfScope: () => droppedOutOfScope,
        getDroppedNoScope: () => droppedNoScope,
        getDroppedHosts: () => droppedHosts,
        whenHydrated,
        isHydrated: () => isHydrated,
        resetState: () => {
            recording = false;
            targetDomains = [];
            capturedRequests = {};
            droppedOutOfScope = 0;
            droppedNoScope = 0;
            lastDroppedHost = "";
            droppedHosts = {};
            swazzUrl = DEFAULT_STATE.swazzUrl;
            pendingRequests.clear();
            countedRequests.clear();
            wrHopMap.clear();
        }
    };
}
