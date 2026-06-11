import { useState, useEffect } from 'react';

export function useAuth() {
    const [authEnabled, setAuthEnabled] = useState(false);
    const [token, setToken] = useState<string | null>(localStorage.getItem('swazz_token'));
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetch('/api/info')
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

    const login = async (email: string, password: string) => {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        setToken(data.token);
        localStorage.setItem('swazz_token', data.token);
    };

    const register = async (email: string, password: string) => {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');
        
        // Auto-login after registration (dummy token from register endpoint or call login)
        const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const loginData = await loginRes.json();
        if (loginRes.ok) {
            setToken(loginData.token);
            localStorage.setItem('swazz_token', loginData.token);
        }
    };

    const logout = () => {
        setToken(null);
        localStorage.removeItem('swazz_token');
    };

    return { authEnabled, token, isLoading, login, register, logout };
}
