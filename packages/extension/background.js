if (typeof importScripts === 'function') {
    importScripts('har.js', 'scope.js');
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
    swazzUrl: "http://localhost:5173",
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

// Map from requestId -> { key, timestamp } for response correlation (B2)
const pendingRequests = new Map();

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

// Hydrate module-level state on startup
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([
        'recording',
        'targetDomains',
        'capturedRequests',
        'droppedOutOfScope',
        'droppedNoScope',
        'lastDroppedHost',
        'droppedHosts'
    ], (state) => {
        if (state) {
            recording = !!state.recording;
            targetDomains = state.targetDomains || [];
            capturedRequests = state.capturedRequests || {};
            droppedOutOfScope = state.droppedOutOfScope || 0;
            droppedNoScope = state.droppedNoScope || 0;
            lastDroppedHost = state.lastDroppedHost || "";
    droppedHosts = state.droppedHosts || {};
        }
        updateBadge();
    });
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

    if (!isDomainTargeted(host, targetDomains)) {
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
    const path = parsedUrl.pathname || '/';
    const normalized = normalizePath(path);

    // Key is Method + Normalized Path (for grouping)
    const key = `${method}:${normalized}`;

    // Exclude common noise assets
    const fileExtension = path.split('.').pop().toLowerCase();
    const ignoredExtensions = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'map'];
    if (ignoredExtensions.includes(fileExtension)) return;

    let existing = capturedRequests[key];
    if (!existing) {
        existing = {
            key,
            method,
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

    existing.count += 1;
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

// B4: Listen for document navigation on committed
if (typeof chrome !== 'undefined' && chrome.webNavigation && chrome.webNavigation.onCommitted) {
    chrome.webNavigation.onCommitted.addListener((details) => {
        // Only capture top-level frame navigation
        if (details.frameId !== 0) return;
        if (!details.url || !details.url.startsWith('http')) return;

        processCapturedRequest({
            url: details.url,
            method: 'GET',
            headers: {},
            body: ''
        }, null);
    });
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
        processCapturedRequest(message.data, sender ? sender.tab : null, sender);
        return;
    }

    if (message.type === 'response') {
        processCapturedResponse(message.data, sender);
        return;
    }
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
        getCapturedRequests: () => capturedRequests,
        setCapturedRequests: (val) => { capturedRequests = val; },
        getRecording: () => recording,
        setRecording: (val) => { recording = val; },
        getTargetDomains: () => targetDomains,
        setTargetDomains: (val) => { targetDomains = val; },
        getDroppedOutOfScope: () => droppedOutOfScope,
        getDroppedNoScope: () => droppedNoScope,
        getDroppedHosts: () => droppedHosts,
        resetState: () => {
            recording = false;
            targetDomains = [];
            capturedRequests = {};
            droppedOutOfScope = 0;
            droppedNoScope = 0;
            lastDroppedHost = "";
            droppedHosts = {};
            pendingRequests.clear();
        }
    };
}
