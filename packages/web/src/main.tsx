import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.js';

// Intercept all fetch calls to inject credentials: 'include' for the Swazz API
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isApiRequest = url.includes('/api/') || url.startsWith('/api/');
    if (isApiRequest) {
        const newInit = { ...init };
        newInit.credentials = 'include';
        const res = await originalFetch(input, newInit);
        if (res.status === 401) {
            const isAuthRoute = url.includes('/api/auth/login') || url.includes('/api/auth/register') || url.includes('/api/auth/guest');
            if (!isAuthRoute) {
                localStorage.removeItem('swazz_token');
                sessionStorage.removeItem('swazz_guest');
                window.location.reload();
            }
        }
        return res;
    }
    return originalFetch(input, init);
};

console.log(
    '%c🛡️ Swazz API Fuzzer\n%cJoin the development on GitHub: https://github.com/SecH0us3/swazz\n💡 Suggesting an idea is also participation!',
    'font-size: 20px; font-weight: bold; color: #8b5cf6;',
    'font-size: 14px; color: #a1a1aa; line-height: 1.5;'
);

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
