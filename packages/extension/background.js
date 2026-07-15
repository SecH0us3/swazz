// Default state
const DEFAULT_STATE = {
    recording: false,
    targetDomains: [], // List of domain strings, e.g. ["localhost:8080", "example.com"]
    capturedRequests: {}, // Map of key -> request details
    token: null,
    swazzUrl: "http://localhost:5173",
    projectId: null,
    projectName: "",
    userProfile: null
};

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

// Helper to normalize paths (e.g. replace digits/ULIDs with {id} placeholder for better grouping)
function normalizePath(path) {
    let clean = path;
    // Replace typical UUIDs
    clean = clean.replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '{uuid}');
    // Replace typical ULIDs (26 char alphanumeric)
    clean = clean.replace(/[0-9AHJKMNPQRSTVWXYZahjkmnpqrstvwxyz]{26}/g, '{ulid}');
    // Replace numeric IDs (longer than 1 digit, or segment matches exactly a number)
    const segments = clean.split('/');
    for (let i = 0; i < segments.length; i++) {
        if (/^\d+$/.test(segments[i]) && segments[i].length > 0) {
            segments[i] = '{id}';
        }
    }
    return segments.join('/');
}

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
function isDomainTargeted(host, targetDomains) {
    if (!targetDomains || targetDomains.length === 0) return false;
    const cleanHost = stripPort(host);
    return targetDomains.some(target => {
        const t = stripPort(target);
        if (!t) return false;
        // Only allow exact match or subdomain (not substring to prevent spoofing)
        return cleanHost === t || cleanHost.endsWith('.' + t);
    });
}

// Listen for messages from Content Script or Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'swazz-detector') return;

    if (message.type === 'auth_sync') {
        // Auto-synchronize credentials from Dashboard tab
        const { token, userProfile, swazzUrl } = message.data;
        chrome.storage.local.set({ token, userProfile, swazzUrl });
        return;
    }

    if (message.type === 'get_my_tab_id') {
        sendResponse({ tabId: sender.tab ? sender.tab.id : null });
        return;
    }

    if (message.type === 'request') {
        // Handle captured request — read current state and immediately set back
        // to avoid race conditions with concurrent handlers
        chrome.storage.local.get(['recording', 'targetDomains', 'capturedRequests'], (state) => {
            if (!state.recording) return;
            // Clone to avoid mutation side effects from concurrent callbacks
            const capturedRequests = Object.assign({}, state.capturedRequests);

            try {
                const reqData = message.data;
                const parsedUrl = new URL(reqData.url);
                const host = parsedUrl.host;

                // Check scope filter
                if (!isDomainTargeted(host, state.targetDomains)) return;

                const method = reqData.method.toUpperCase();
                const path = parsedUrl.pathname;
                const normalized = normalizePath(path);
                
                // Security check: validate that the sender tab's origin matches the host of the captured request.
                // This prevents request injection/parameter pollution from malicious websites.
                if (sender.tab && sender.tab.url) {
                    try {
                        const tabUrl = new URL(sender.tab.url);
                        if (tabUrl.host !== host) {
                            console.warn(`[Swazz Security] Origin mismatch: request to ${host} was sent from tab at ${tabUrl.host}. Dropping request.`);
                            return;
                        }
                    } catch (e) {
                        return;
                    }
                }

                // Key is Method + Normalized Path (for grouping)
                const key = `${method}:${normalized}`;

                // Get query parameters array
                const queryParams = [];
                parsedUrl.searchParams.forEach((value, name) => {
                    queryParams.push({ name, value });
                });
                const queryStringStr = parsedUrl.search;

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
                        status: "needs_work" // status: needs_work | well_covered
                    };
                }

                existing.count += 1;
                existing.lastCaptured = Date.now();
                existing.exampleUrl = reqData.url;

                // Track query keys
                queryParams.forEach(qp => {
                    if (!existing.queryKeys.includes(qp.name)) {
                        existing.queryKeys.push(qp.name);
                    }
                });

                // Track unique query string values (max 20 variations)
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
                    } else if (bodyStr.length > 0 && uniqueBodyCount < 2) {
                        recommendation = `💡 Tip: Resubmit this API request/form with different field inputs (currently captured ${uniqueBodyCount} variation).`;
                    } else {
                        recommendation = `✅ Excellent coverage! Multiple dynamic parameter variations recorded (${totalVariations} total).`;
                        status = "well_covered";
                    }
                }

                existing.recommendation = recommendation;
                existing.status = status;
                
                // Write back to storage using the cloned copy
                capturedRequests[key] = existing;
                chrome.storage.local.set({ capturedRequests });
            } catch (err) {
                console.error("Failed to process captured request in background:", err);
            }
        });
    }
});
