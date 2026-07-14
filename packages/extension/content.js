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
    if (host.includes('localhost:5173') || host.includes('swazz.secmy.app')) {
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
    const cleanHost = host.trim().toLowerCase();
    return targetDomains.some(target => {
        const t = target.trim().toLowerCase();
        if (!t) return false;
        return cleanHost === t || cleanHost.endsWith('.' + t) || cleanHost.includes(t);
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
