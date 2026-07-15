(function() {
    // Intercept programmatic click() calls on HTMLInputElement
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function() {
        const isCrawling = document.documentElement.getAttribute('data-swazz-crawling') === 'true';
        if (this.type === 'file' && isCrawling) {
            console.log("[Swazz] Intercepted programmatic file input click via prototype monkeypatch.");
            try {
                // Create a mock PNG file
                const mockFile = new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])], "swazz_mock.png", { type: "image/png" });
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(mockFile);
                this.files = dataTransfer.files;
                
                // Dispatch input and change events to notify the application
                this.dispatchEvent(new Event('input', { bubbles: true }));
                this.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (err) {
                console.error("[Swazz] Failed to set mock file on programmatic click:", err);
            }
            return; // Bypass the original click to avoid native file dialog
        }
        return originalClick.apply(this, arguments);
    };

    // Intercept physical / dispatched click events on DOM inputs
    document.addEventListener('click', (e) => {
        const isCrawling = document.documentElement.getAttribute('data-swazz-crawling') === 'true';
        if (isCrawling && e.target && e.target.tagName === 'INPUT' && e.target.type === 'file') {
            e.preventDefault(); // Prevent dialog from showing
            try {
                const mockFile = new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])], "swazz_mock.png", { type: "image/png" });
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(mockFile);
                e.target.files = dataTransfer.files;
                
                e.target.dispatchEvent(new Event('input', { bubbles: true }));
                e.target.dispatchEvent(new Event('change', { bubbles: true }));
                console.log("[Swazz] Intercepted file input click event. Loaded mock file swazz_mock.png.");
            } catch (err) {
                console.error("[Swazz] Failed to set mock file on click event:", err);
            }
        }
    }, true); // Use capture phase to intercept early
})();
