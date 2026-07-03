import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function useAuth() {
    const [authEnabled, setAuthEnabled] = useState(false);
    const [githubAuthEnabled, setGithubAuthEnabled] = useState(false);
    const [token, setToken] = useState<string | null>(localStorage.getItem('swazz_token'));
    const [isGuest, setIsGuest] = useState(sessionStorage.getItem('swazz_guest') === 'true');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const exchangeCode = urlParams.get('exchange_code');
        if (exchangeCode) {
            fetch(`${PROXY_URL}/api/auth/oauth/exchange`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code: exchangeCode })
            })
            .then(res => {
                if (!res.ok) throw new Error('Failed to exchange code');
                return res.json();
            })
            .then(data => {
                const authToken = data.token;
                localStorage.setItem('swazz_token', authToken);
                setToken(authToken);
                setIsGuest(false);
                sessionStorage.removeItem('swazz_guest');
            })
            .catch(err => {
                console.error(err);
            });
            
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('exchange_code');
            window.history.replaceState({}, '', newUrl);
        }

        const authToken = urlParams.get('auth_token');
        if (authToken) {
            localStorage.setItem('swazz_token', authToken);
            setToken(authToken);
            setIsGuest(false);
            sessionStorage.removeItem('swazz_guest');
            
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('auth_token');
            window.history.replaceState({}, '', newUrl);
        }
    }, []);

    useEffect(() => {
        fetch(`${PROXY_URL}/api/info`)
            .then(res => {
                const csrf = res.headers.get('X-CSRF-Token');
                if (csrf) {
                    useAppStore.setState({ csrfToken: csrf });
                }
                return res.json();
            })
            .then(data => {
                setAuthEnabled(!!data.auth_enabled);
                setGithubAuthEnabled(!!data.github_auth_enabled);
                if (data.turnstile_site_key) {
                    useAppStore.setState({ turnstileSiteKey: data.turnstile_site_key });
                }
                setIsLoading(false);
            })
            .catch(() => {
                setAuthEnabled(false);
                setIsLoading(false);
            });
    }, []);

    const solvePoW = async (challenge: string, difficulty: number): Promise<number> => {
        return new Promise((resolve, reject) => {
            const workerCode = `
                self.onmessage = async (e) => {
                    const { challenge, difficulty } = e.data;
                    const targetPrefix = '0'.repeat(difficulty);
                    let nonce = 0;
                    const encoder = new TextEncoder();
                    while (true) {
                        const text = challenge + nonce;
                        const data = encoder.encode(text);
                        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                        
                        if (hashHex.startsWith(targetPrefix)) {
                            self.postMessage(nonce);
                            break;
                        }
                        nonce++;
                    }
                };
            `;
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            const worker = new Worker(workerUrl);
            
            worker.onmessage = (event) => {
                resolve(event.data);
                worker.terminate();
                URL.revokeObjectURL(workerUrl);
            };
            
            worker.onerror = (error) => {
                reject(error);
                worker.terminate();
                URL.revokeObjectURL(workerUrl);
            };
            
            worker.postMessage({ challenge, difficulty });
        });
    };

    const login = async (username: string, password: string, twoFactorCode?: string, turnstileToken?: string) => {
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        // Step 1: Request challenge token
        const step1Res = await fetch(`${PROXY_URL}/api/auth/login/step1`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
                username,
                'cf-turnstile-response': turnstileToken
            })
        });
        const step1Data = await step1Res.json();
        if (!step1Res.ok) throw new Error(step1Data.error || 'Login failed (Step 1)');

        const { token: challengeToken, challenge, difficulty } = step1Data;

        // Solve Proof of Work
        const nonce = await solvePoW(challenge, difficulty);

        // Step 2: Submit credentials, nonce, and Turnstile response
        const res = await fetch(`${PROXY_URL}/api/auth/login`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                token: challengeToken,
                password,
                nonce,
                two_factor_code: twoFactorCode,
                'cf-turnstile-response': turnstileToken
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        if (data.status === '2fa_required') {
            return { twoFactorRequired: true };
        }
        setToken(data.token);
        localStorage.setItem('swazz_token', data.token);
        setIsGuest(false);
        sessionStorage.removeItem('swazz_guest');
        return { success: true };
    };

    const register = async (username: string, password: string, email?: string, turnstileToken?: string) => {
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        const res = await fetch(`${PROXY_URL}/api/auth/register`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
                username, 
                password, 
                email,
                'cf-turnstile-response': turnstileToken
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');
        
        if (data.token) {
            setToken(data.token);
            localStorage.setItem('swazz_token', data.token);
            setIsGuest(false);
            sessionStorage.removeItem('swazz_guest');
        } else {
            await login(username, password);
        }
    };

    const continueAsGuest = async (turnstileToken?: string) => {
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        // Step 1: Request challenge token for Guest login
        const step1Res = await fetch(`${PROXY_URL}/api/auth/guest/step1`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ 
                'cf-turnstile-response': turnstileToken
            })
        });
        const step1Data = await step1Res.json();
        if (!step1Res.ok) throw new Error(step1Data.error || 'Guest login failed (Step 1)');

        const { token: challengeToken, challenge, difficulty } = step1Data;

        // Solve Proof of Work
        const nonce = await solvePoW(challenge, difficulty);

        // Step 2: Finalize guest session creation with Turnstile response
        const res = await fetch(`${PROXY_URL}/api/auth/guest`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                token: challengeToken,
                nonce,
                'cf-turnstile-response': turnstileToken
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Guest login failed');
        setToken(data.token);
        localStorage.setItem('swazz_token', data.token);
        setIsGuest(true);
        sessionStorage.setItem('swazz_guest', 'true');
    };

    const logout = () => {
        setToken(null);
        localStorage.removeItem('swazz_token');
        setIsGuest(false);
        sessionStorage.removeItem('swazz_guest');
    };

    return { authEnabled, githubAuthEnabled, token, isGuest, isLoading, login, register, continueAsGuest, logout };
}
