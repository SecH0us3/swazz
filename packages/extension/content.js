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
            const projectsStr = localStorage.getItem('swazz:projects'); // cached projects if any
            
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

// Periodically check in case of post-load logins
setInterval(checkAndSyncDashboardToken, 3000);
