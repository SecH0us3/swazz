/**
 * Vitest global setup
 *
 * Node 25+ ships a native Web Storage API that conflicts with jsdom's
 * implementation — localStorage calls can throw "not a function" errors
 * in the test environment. This setup ensures jsdom's in-memory
 * localStorage is always used, regardless of the Node version.
 */

// If localStorage is missing or broken in this environment, install a simple in-memory mock.
function isLocalStorageFunctional(): boolean {
    try {
        localStorage.setItem('__vitest_probe__', '1');
        localStorage.removeItem('__vitest_probe__');
        return true;
    } catch {
        return false;
    }
}

if (!isLocalStorageFunctional()) {
    const store: Record<string, string> = {};
    const mockStorage: Storage = {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => { store[key] = String(value); },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
        key: (index: number) => Object.keys(store)[index] ?? null,
        get length() { return Object.keys(store).length; },
    };
    Object.defineProperty(global, 'localStorage', { value: mockStorage, writable: true });
}
