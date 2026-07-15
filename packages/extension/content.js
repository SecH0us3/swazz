// Inject the MAIN world script (inject.js) into the page context
try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
} catch (e) {
    console.error("Swazz content script: failed to inject helper", e);
}

// Listen for messages from the page's MAIN world context
window.addEventListener('message', (event) => {
    // Check message integrity
    if (event.source !== window) return;
    if (event.data && event.data.source === 'swazz-detector') {
        // Forward message to the extension background service worker
        chrome.runtime.sendMessage(event.data);
    }
});

// Auto-sync token when visiting the Swazz Dashboard page
function checkAndSyncDashboardToken() {
    const host = window.location.host;
    if (host === 'localhost:5173' || host === 'swazz.secmy.app' || host.endsWith('.swazz.secmy.app')) {
        try {
            // Check token in local storage
            const token = localStorage.getItem('swazz_token');
            const profileStr = localStorage.getItem('swazz:user_profile');
            
            if (token) {
                let userProfile = null;
                try {
                    userProfile = profileStr ? JSON.parse(profileStr) : null;
                } catch {}

                chrome.runtime.sendMessage({
                    source: 'swazz-detector',
                    type: 'auth_sync',
                    data: {
                        token,
                        userProfile,
                        swazzUrl: window.location.origin
                    }
                });
            }
        } catch (e) {
            // Ignore access errors if third party restrictions exist
        }
    }
}

// Execute checks on load and periodically
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkAndSyncDashboardToken);
} else {
    checkAndSyncDashboardToken();
}

// Listen for storage changes to sync token reactively
window.addEventListener('storage', (e) => {
    if (e.key === 'swazz_token' || e.key === 'swazz:user_profile') {
        checkAndSyncDashboardToken();
    }
});


// ==========================================
// DOM VULNERABILITY HIGHLIGHTER
// ==========================================

let mutationObserver = null;
let injectedStyles = null;

function isDomainTargeted(host, targetDomains) {
    if (!targetDomains || targetDomains.length === 0) return false;
    const cleanHost = host.split(':')[0].trim().toLowerCase();
    return targetDomains.some(target => {
        const t = target.split(':')[0].trim().toLowerCase();
        if (!t) return false;
        // Only allow exact match or subdomain (not substring to prevent spoofing)
        return cleanHost === t || cleanHost.endsWith('.' + t);
    });
}

function injectHighlighterStyles() {
    if (injectedStyles) return;
    
    injectedStyles = document.createElement('style');
    injectedStyles.id = 'swazz-highlighter-styles';
    injectedStyles.textContent = `
        .swazz-highlight-input {
            border: 2px dashed #f59e0b !important;
            box-shadow: 0 0 6px rgba(245, 158, 11, 0.3) !important;
            transition: all 0.3s ease !important;
        }
        
        .swazz-highlight-input-critical {
            border: 2px dashed #ef4444 !important;
            box-shadow: 0 0 6px rgba(239, 68, 68, 0.3) !important;
        }

        .swazz-vuln-badge {
            display: inline-block !important;
            position: absolute !important;
            margin-left: -90px !important;
            margin-top: 6px !important;
            background: rgba(17, 24, 39, 0.95) !important;
            color: #f59e0b !important;
            border: 1px solid rgba(245, 158, 11, 0.3) !important;
            padding: 2px 6px !important;
            border-radius: 4px !important;
            font-size: 10px !important;
            font-family: system-ui, -apple-system, sans-serif !important;
            pointer-events: auto !important;
            z-index: 10000 !important;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3) !important;
            cursor: help !important;
            white-space: nowrap !important;
        }

        .swazz-vuln-badge-critical {
            color: #ef4444 !important;
            border-color: rgba(239, 68, 68, 0.3) !important;
        }

        .swazz-vuln-tooltip {
            position: absolute !important;
            bottom: 125% !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            background: #111827 !important;
            color: #f9fafb !important;
            border: 1px solid #374151 !important;
            padding: 8px 10px !important;
            border-radius: 6px !important;
            font-size: 11px !important;
            width: 220px !important;
            white-space: normal !important;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5) !important;
            z-index: 10001 !important;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s ease !important;
            text-align: left !important;
            line-height: 1.4 !important;
        }

        .swazz-vuln-badge:hover .swazz-vuln-tooltip {
            opacity: 1;
        }
    `;
    document.head.appendChild(injectedStyles);
}

function scanAndHighlight() {
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select');
    
    inputs.forEach(input => {
        if (input.classList.contains('swazz-highlight-input') || input.dataset.swazzProcessed) return;
        
        let vulnerabilities = [];
        let isCritical = false;

        const pattern = input.getAttribute('pattern');
        const maxLength = input.getAttribute('maxlength');
        const type = input.getAttribute('type') || 'text';
        
        if (type === 'text' || input.tagName.toLowerCase() === 'textarea') {
            if (!pattern && !maxLength) {
                vulnerabilities.push('⚠️ Missing format pattern and length checks (high XSS/SQLi risk)');
            }
        }

        const parentForm = input.closest('form');
        if (parentForm && !parentForm.dataset.swazzCsrfChecked) {
            const hasCsrf = parentForm.querySelector('input[name*="csrf" i], input[name*="xsrf" i], input[name*="token" i]');
            if (!hasCsrf) {
                isCritical = true;
                vulnerabilities.push('🚨 Missing Anti-CSRF token in form submission');
            }
            parentForm.dataset.swazzCsrfChecked = 'true';
        }

        if (type === 'file') {
            const accept = input.getAttribute('accept');
            if (!accept) {
                isCritical = true;
                vulnerabilities.push('🚨 File upload lacks filetype restriction (missing accept attribute)');
            }
        }

        if (type === 'number') {
            const min = input.getAttribute('min');
            const max = input.getAttribute('max');
            if (!min && !max) {
                vulnerabilities.push('⚠️ Numeric input lacks range limits (min/max)');
            }
        }

        if (vulnerabilities.length > 0) {
            input.classList.add('swazz-highlight-input');
            if (isCritical) {
                input.classList.add('swazz-highlight-input-critical');
            }

            const badge = document.createElement('div');
            badge.className = `swazz-vuln-badge ${isCritical ? 'swazz-vuln-badge-critical' : ''}`;
            badge.textContent = isCritical ? '🚨 Vuln Risk' : '⚠️ Low Validation';
            
            const tooltip = document.createElement('div');
            tooltip.className = 'swazz-vuln-tooltip';
            tooltip.innerHTML = `<strong>Swazz Low Validation Risk Analysis:</strong><br>${vulnerabilities.join('<br>')}`;
            badge.appendChild(tooltip);

            const parent = input.parentElement;
            if (parent) {
                const parentStyle = window.getComputedStyle(parent);
                if (parentStyle.position === 'static') {
                    parent.style.position = 'relative';
                }
                input.insertAdjacentElement('afterend', badge);
            }

            input.dataset.swazzProcessed = 'true';
        }
    });
}

function disableHighlighter() {
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
    
    if (injectedStyles) {
        injectedStyles.remove();
        injectedStyles = null;
    }

    document.querySelectorAll('.swazz-highlight-input').forEach(input => {
        input.classList.remove('swazz-highlight-input');
        input.classList.remove('swazz-highlight-input-critical');
        delete input.dataset.swazzProcessed;
    });

    document.querySelectorAll('form').forEach(form => {
        delete form.dataset.swazzCsrfChecked;
    });

    document.querySelectorAll('.swazz-vuln-badge').forEach(badge => {
        badge.remove();
    });
}

function enableHighlighter() {
    injectHighlighterStyles();
    scanAndHighlight();

    if (!mutationObserver) {
        mutationObserver = new MutationObserver(() => {
            scanAndHighlight();
        });
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}

function updateHighlightState(recording, targetDomains) {
    const isTarget = isDomainTargeted(window.location.host, targetDomains);
    const shouldHighlight = recording && isTarget;

    if (shouldHighlight) {
        enableHighlighter();
    } else {
        disableHighlighter();
    }
}

// Load initial storage state and toggle highlighter accordingly
chrome.storage.local.get(['recording', 'targetDomains'], (state) => {
    updateHighlightState(!!state.recording, state.targetDomains || []);
});

// React to storage changes dynamically
chrome.storage.onChanged.addListener(() => {
    chrome.storage.local.get(['recording', 'targetDomains'], (state) => {
        updateHighlightState(!!state.recording, state.targetDomains || []);
    });
});

// ==========================================
// BROWSER EXTENSION-DRIVEN CRAWLER
// ==========================================

let lastProcessedUrl = null;

function isCrawlTargetInScope(urlStr, targetDomains) {
    try {
        const u = new URL(urlStr, window.location.href);
        // Only http/https
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        
        // Check host matches targeted domains
        const host = u.host;
        const inScope = isDomainTargeted(host, targetDomains);
        if (!inScope) return false;
        
        // Exclude common static files/extensions
        const path = u.pathname;
        const fileExtension = path.split('.').pop().toLowerCase();
        const ignoredExtensions = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'map', 'zip', 'pdf', 'tar', 'gz'];
        if (ignoredExtensions.includes(fileExtension)) return false;
        
        return true;
    } catch (e) {
        return false;
    }
}

function getFormSignature(form) {
    try {
        const action = form.getAttribute('action') || '';
        const method = (form.getAttribute('method') || 'get').toLowerCase();
        const inputs = Array.from(form.querySelectorAll('input[name], textarea[name], select[name]'))
            .map(i => i.getAttribute('name'))
            .filter(Boolean)
            .sort()
            .join(',');
        return `${method}:${action}:${inputs}`;
    } catch (e) {
        return 'unknown';
    }
}

async function runCrawlStep() {
    const state = await new Promise(r => chrome.storage.local.get(['recording', 'targetDomains', 'crawlState'], r));
    if (!state.recording || !state.crawlState || !state.crawlState.crawling) {
        document.documentElement.setAttribute('data-swazz-crawling', 'false');
        return;
    }
    document.documentElement.setAttribute('data-swazz-crawling', 'true');

    const myTabResponse = await new Promise(resolve => {
        chrome.runtime.sendMessage({ source: 'swazz-detector', type: 'get_my_tab_id' }, resolve);
    });
    const myTabId = myTabResponse ? myTabResponse.tabId : null;
    if (myTabId && state.crawlState.tabId !== myTabId) {
        return; // Mismatch - ignore crawl execution on this tab
    }

    const crawlState = state.crawlState;
    const targetDomains = state.targetDomains || [];
    const currentUrl = window.location.href;

    if (lastProcessedUrl === currentUrl) {
        return; // Prevent duplicate step execution on same URL/state
    }
    lastProcessedUrl = currentUrl;

    // 1. Mark current URL as visited
    if (!crawlState.visited.includes(currentUrl)) {
        crawlState.visited.push(currentUrl);
        crawlState.stats.linksVisited++;
    }

    // 2. Scan for links on current page
    const links = document.querySelectorAll('a[href]');
    links.forEach(a => {
        try {
            const resolved = new URL(a.href, window.location.href).href;
            if (isCrawlTargetInScope(resolved, targetDomains)) {
                // If not visited and not in queue, add to queue
                if (!crawlState.visited.includes(resolved) && !crawlState.queue.includes(resolved)) {
                    if (crawlState.visited.length + crawlState.queue.length < crawlState.limit) {
                        crawlState.queue.push(resolved);
                    }
                }
            }
        } catch (e) {}
    });

    // 3. Find and fill/submit forms on the page
    const forms = document.querySelectorAll('form');
    let formsToSubmit = [];
    const submittedForms = crawlState.submittedForms || [];
    
    forms.forEach(form => {
        const sig = getFormSignature(form);
        const alreadySubmitted = submittedForms.includes(sig);
        if (!form.dataset.swazzCrawled && !alreadySubmitted && crawlState.stats.formsSubmitted < crawlState.formLimit) {
            form.dataset.swazzCrawled = 'true';
            formsToSubmit.push({ form, signature: sig });
        }
    });

    for (const { form, signature } of formsToSubmit) {
        // Fill form fields
        const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, select');
        inputs.forEach(input => {
            const type = input.getAttribute('type') || 'text';
            if (type === 'email') {
                input.value = 'test@example.com';
            } else if (type === 'number') {
                input.value = '123';
            } else {
                input.value = 'test';
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Save progress to storage BEFORE submitting
        crawlState.stats.formsSubmitted++;
        if (!submittedForms.includes(signature)) {
            submittedForms.push(signature);
        }
        crawlState.submittedForms = submittedForms;
        await new Promise(r => chrome.storage.local.set({ crawlState }, r));

        // Submit form
        try {
            const submitBtn = form.querySelector('input[type="submit"], button[type="submit"], button:not([type])');
            if (submitBtn) {
                submitBtn.click();
            } else {
                form.submit();
            }
            await new Promise(r => setTimeout(r, 800));
        } catch (e) {
            console.error("Form submission failed:", e);
        }
    }

    // 3.5 Find and click clickable elements (buttons, tabs, interactive elements)
    const clickables = document.querySelectorAll('button, [role="button"], input[type="button"]');
    let buttonsToClick = [];
    clickables.forEach(btn => {
        if (!btn.dataset.swazzClicked) {
            btn.dataset.swazzClicked = 'true';
            
            const text = (btn.textContent || btn.value || '').toLowerCase().trim();
            const isIgnored = /logout|log[ -]?out|sign[ -]?out|delete|remove|clear|cancel|exit/i.test(text);
            if (!isIgnored) {
                buttonsToClick.push(btn);
            }
        }
    });

    for (const btn of buttonsToClick) {
        try {
            btn.click();
            await new Promise(r => setTimeout(r, 200));
        } catch (e) {
            console.error("Button click failed:", e);
        }
    }

    // 4. Update state in storage
    await new Promise(r => chrome.storage.local.set({ crawlState }, r));

    // 5. Navigate to the next URL in the queue if any, otherwise finish
    if (crawlState.stats.linksVisited >= crawlState.limit || crawlState.queue.length === 0) {
        crawlState.crawling = false;
        document.documentElement.setAttribute('data-swazz-crawling', 'false');
        await new Promise(r => chrome.storage.local.set({ crawlState }, r));
        chrome.runtime.sendMessage({ source: 'swazz-detector', type: 'crawl_complete', data: crawlState.stats });
        return;
    }

    // Dequeue next URL
    const nextUrl = crawlState.queue.shift();
    await new Promise(r => chrome.storage.local.set({ crawlState }, r));

    setTimeout(() => {
        // Find link with href matching nextUrl
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        const targetLink = allLinks.find(a => {
            try {
                return new URL(a.href, window.location.href).href === nextUrl;
            } catch (e) {
                return false;
            }
        });

        if (targetLink) {
            targetLink.click();
        } else {
            // Fallback: hard navigate if the link is not present
            window.location.href = nextUrl;
        }

        // Wait to see if page reloads. If not (SPA router transition), trigger next step
        setTimeout(() => {
            chrome.storage.local.get(['crawlState'], (res) => {
                if (res.crawlState && res.crawlState.crawling) {
                    runCrawlStep();
                }
            });
        }, 1500);
    }, 500);
}

// Listen for crawl commands from background/popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'swazz-detector') return;

    if (message.type === 'start_crawl') {
        const startUrl = window.location.href;
        lastProcessedUrl = null;
        chrome.storage.local.get(['recording', 'targetDomains'], (state) => {
            if (!state.recording) {
                sendResponse({ error: 'Please start recording traffic first!' });
                return;
            }
            const initialCrawlState = {
                crawling: true,
                tabId: message.tabId,
                visited: [],
                queue: [startUrl],
                submittedForms: [],
                stats: { linksVisited: 0, formsSubmitted: 0 },
                limit: 50,
                formLimit: 10
            };
            chrome.storage.local.set({ crawlState: initialCrawlState }, () => {
                document.documentElement.setAttribute('data-swazz-crawling', 'true');
                setTimeout(runCrawlStep, 300);
                sendResponse({ success: true });
            });
        });
        return true;
    }
});

// Resume crawling automatically on page load
chrome.storage.local.get(['crawlState'], (state) => {
    if (state.crawlState && state.crawlState.crawling) {
        chrome.runtime.sendMessage({ source: 'swazz-detector', type: 'get_my_tab_id' }, (response) => {
            const myTabId = response ? response.tabId : null;
            if (myTabId && state.crawlState.tabId === myTabId) {
                document.documentElement.setAttribute('data-swazz-crawling', 'true');
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => setTimeout(runCrawlStep, 800));
                } else {
                    setTimeout(runCrawlStep, 800);
                }
            }
        });
    }
});

