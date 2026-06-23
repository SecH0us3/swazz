import { useState, useEffect } from 'react';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function useAuth() {
    const [authEnabled, setAuthEnabled] = useState(false);
    const [token, setToken] = useState<string | null>(localStorage.getItem('swazz_token'));
    const [isGuest, setIsGuest] = useState(sessionStorage.getItem('swazz_guest') === 'true');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetch(`${PROXY_URL}/api/info`)
            .then(res => res.json())
            .then(data => {
                setAuthEnabled(!!data.auth_enabled);
                setIsLoading(false);
            })
            .catch(() => {
                setAuthEnabled(false);
                setIsLoading(false);
            });
    }, []);

    const login = async (username: string, password: string) => {
        const res = await fetch(`${PROXY_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        setToken(data.token);
        localStorage.setItem('swazz_token', data.token);
        setIsGuest(false);
        sessionStorage.removeItem('swazz_guest');
    };

    const register = async (username: string, password: string) => {
        const res = await fetch(`${PROXY_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');
        
        // Auto-login after registration
        const loginRes = await fetch(`${PROXY_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const loginData = await loginRes.json();
        if (loginRes.ok) {
            setToken(loginData.token);
            localStorage.setItem('swazz_token', loginData.token);
            setIsGuest(false);
            sessionStorage.removeItem('swazz_guest');
        }
    };

    const continueAsGuest = async () => {
        const res = await fetch(`${PROXY_URL}/api/auth/guest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
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

    return { authEnabled, token, isGuest, isLoading, login, register, continueAsGuest, logout };
}
