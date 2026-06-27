import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function useAuth() {
    const [authEnabled, setAuthEnabled] = useState(false);
    const [token, setToken] = useState<string | null>(localStorage.getItem('swazz_token'));
    const [isGuest, setIsGuest] = useState(sessionStorage.getItem('swazz_guest') === 'true');
    const [isLoading, setIsLoading] = useState(true);

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
                setIsLoading(false);
            })
            .catch(() => {
                setAuthEnabled(false);
                setIsLoading(false);
            });
    }, []);

    const solvePoW = async (challenge: string, difficulty: number): Promise<number> => {
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
                return nonce;
            }
            nonce++;
        }
    };

    const login = async (username: string, password: string, twoFactorCode?: string) => {
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        // Step 1: Request challenge token
        const step1Res = await fetch(`${PROXY_URL}/api/auth/login/step1`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ username })
        });
        const step1Data = await step1Res.json();
        if (!step1Res.ok) throw new Error(step1Data.error || 'Login failed (Step 1)');

        const { token: challengeToken, challenge, difficulty } = step1Data;

        // Solve Proof of Work
        const nonce = await solvePoW(challenge, difficulty);

        // Step 2: Submit password & nonce
        const res = await fetch(`${PROXY_URL}/api/auth/login`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                token: challengeToken,
                password,
                nonce,
                two_factor_code: twoFactorCode
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

    const register = async (username: string, password: string, email?: string) => {
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        const res = await fetch(`${PROXY_URL}/api/auth/register`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ username, password, email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');
        
        // Auto-login after registration
        await login(username, password);
    };

    const requestMagicLink = async (username: string) => {
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        const res = await fetch(`${PROXY_URL}/api/auth/magic-link/request`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ username })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to request magic link');
        return data;
    };

    const verifyMagicLink = async (token: string) => {
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        const res = await fetch(`${PROXY_URL}/api/auth/magic-link/verify`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Magic link verification failed');
        setToken(data.token);
        localStorage.setItem('swazz_token', data.token);
        setIsGuest(false);
        sessionStorage.removeItem('swazz_guest');
        return { success: true };
    };

    const continueAsGuest = async () => {
        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        const res = await fetch(`${PROXY_URL}/api/auth/guest`, {
            method: 'POST',
            headers
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

    return { authEnabled, token, isGuest, isLoading, login, register, continueAsGuest, logout, requestMagicLink, verifyMagicLink };
}
