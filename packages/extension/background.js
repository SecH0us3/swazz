importScripts('har.js');
const { normalizePath } = self.SwazzHar;

// Default state
const DEFAULT_STATE = {
    recording: false,
    targetDomains: [], // List of domain strings, e.g. ["localhost:8080", "example.com"]
    capturedRequests: {}, // Map of key -> request details
    droppedOutOfScope: 0,
    droppedNoScope: 0,
    lastDroppedHost: "",
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

// Map from requestId -> { key, timestamp } for response correlation (B2)
const pendingRequests = new Map();

// Debounce storage flush state (B5)
let flushTimer = null;
let isFlushing = false;

function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flushStorage, 250);
}

function flushStorage() {
    flushTimer = null;
    isFlushing = true;
    chrome.storage.local.set({
        capturedRequests,
        droppedOutOfScope,
        droppedNoScope,
        lastDroppedHost
    }, () => {
        // Yield to allow storage.onChanged to fire before unsetting isFlushing
        setTimeout(() => {
            isFlushing = false;
        }, 50);
    });
}

function updateBadge() {
    const count = Object.keys(capturedRequests).length;
    if (count > 0) {
        chrome.action.setBadgeText({ text: String(count) });
        chrome.action.setBadgeBackgroundColor({ color: recording ? '#ef4444' : '#6b7280' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// Initialize state in local storage if not present
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

// Hydrate module-level state on startup
chrome.storage.local.get([
    'recording',
    'targetDomains',
    'capturedRequests',
    'droppedOutOfScope',
    'droppedNoScope',
    'lastDroppedHost'
], (state) => {
    if (state) {
        recording = !!state.recording;
        targetDomains = state.targetDomains || [];
        capturedRequests = state.capturedRequests || {};
        droppedOutOfScope = state.droppedOutOfScope || 0;
        droppedNoScope = state.droppedNoScope || 0;
        lastDroppedHost = state.lastDroppedHost || "";
    }
    updateBadge();
});

// Re-hydrate on storage changes not originating from our own flush
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.recording) {
        recording = !!changes.recording.newValue;
        updateBadge();
    }
    if (changes.targetDomains) {
        targetDomains = changes.targetDomains.newValue || [];
    }
    if (changes.capturedRequests) {
        if (!isFlushing) {
            capturedRequests = changes.capturedRequests.newValue || {};
            updateBadge();
        }
    }
    if (changes.droppedOutOfScope && !isFlushing) {
        droppedOutOfScope = changes.droppedOutOfScope.newValue || 0;
    }
    if (changes.droppedNoScope && !isFlushing) {
        droppedNoScope = changes.droppedNoScope.newValue || 0;
    }
    if (changes.lastDroppedHost && !isFlushing) {
        lastDroppedHost = changes.lastDroppedHost.newValue || "";
    }
});

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

// Function to match host against target domains list
function isDomainTargeted(host, domains) {
    if (!domains || domains.length === 0) return false;
    const cleanHost = stripPort(host);
    return domains.some(target => {
        const t = stripPort(target);
        if (!t) return false;
        // Only allow exact match or subdomain (not substring to prevent spoofing)
        return cleanHost === t || cleanHost.endsWith('.' + t);
    });
}

function processCapturedRequest(reqData, senderTab) {
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
        scheduleFlush();
        return;
    }

    // Sender origin check (B1): drop only if neither request host nor tab host is in targetDomains
    if (senderTab && senderTab.url) {
        let tabUrl;
        try {
            tabUrl = new URL(senderTab.url);
        } catch (e) {
            return; // Drop on unparseable sender.tab.url
        }

        const hostInScope = isDomainTargeted(host, targetDomains);
        const tabInScope = isDomainTargeted(tabUrl.host, targetDomains);
        if (!hostInScope && !tabInScope) {
            droppedOutOfScope++;
            lastDroppedHost = host;
            scheduleFlush();
            return;
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
        pendingRequests.set(reqData.requestId, { key, timestamp: Date.now() });
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

function processCapturedResponse(resData) {
    if (!recording || !resData || !resData.requestId) return;

    const pending = pendingRequests.get(resData.requestId);
    if (!pending) return;
    pendingRequests.delete(resData.requestId);

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

// Listen for messages from Content Script or Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'swazz-detector') return;

    if (message.type === 'auth_sync') {
        // B6: Validate sender tab origin against allowlist
        if (!sender.tab || !sender.tab.url) return;
        try {
            const senderUrl = new URL(sender.tab.url);
            const senderOrigin = senderUrl.origin;
            const host = senderUrl.host;
            const isAllowedOrigin = (
                senderOrigin === 'http://localhost:5173' ||
                host === 'swazz.secmy.app' ||
                host.endsWith('.swazz.secmy.app')
            ) && (senderUrl.protocol === 'https:' || senderUrl.protocol === 'http:');

            const { token, userProfile, swazzUrl } = message.data || {};
            if (isAllowedOrigin && swazzUrl === senderOrigin) {
                chrome.storage.local.set({ token, userProfile, swazzUrl });
            } else {
                console.warn('[Swazz Security] Rejected auth_sync from unverified origin:', senderOrigin, swazzUrl);
            }
        } catch (e) {}
        return;
    }

    if (message.type === 'get_my_tab_id') {
        sendResponse({ tabId: sender.tab ? sender.tab.id : null });
        return;
    }

    if (message.type === 'request') {
        processCapturedRequest(message.data, sender.tab);
        return;
    }

    if (message.type === 'response') {
        processCapturedResponse(message.data);
        return;
    }
});
