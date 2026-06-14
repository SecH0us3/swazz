import { useState } from 'react';
import './LoginScreen.css';

interface LoginScreenProps {
    onLogin: (username: string, password: string) => Promise<void>;
    onRegister: (username: string, password: string) => Promise<void>;
}

export function LoginScreen({ onLogin, onRegister }: LoginScreenProps) {
    const [isRegistering, setIsRegistering] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            if (isRegistering) {
                await onRegister(username, password);
            } else {
                await onLogin(username, password);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-screen-overlay">
            <div className="login-modal">
                <div className="login-header">
                    <h2>{isRegistering ? 'Create Account' : 'Welcome to Swazz'}</h2>
                    <p>{isRegistering ? 'Register to start fuzzing' : 'Sign in to continue to your workspace'}</p>
                </div>
                {error && <div className="login-error">{error}</div>}
                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="username">Username</label>
                        <input
                            type="text"
                            id="username"
                            name="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter username"
                            autoComplete="username"
                            required
                            pattern="^[a-zA-Z0-9_-]{3,20}$"
                            title="3 to 20 characters, alphanumeric, including hyphen or underscore"
                        />
                        <span id="username-hint" className="field-hint">3-20 characters (letters, numbers, _ or -)</span>
                    </div>
                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <div className="password-input-wrapper">
                            <input
                                type={showPassword ? "text" : "password"}
                                id="password"
                                name="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                autoComplete={isRegistering ? "new-password" : "current-password"}
                                required
                                minLength={8}
                            />
                            <button
                                type="button"
                                className="password-toggle-btn"
                                onClick={() => setShowPassword(!showPassword)}
                                aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                                {showPassword ? (
                                    <svg className="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                        <line x1="1" y1="1" x2="23" y2="23"></line>
                                    </svg>
                                ) : (
                                    <svg className="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                )}
                            </button>
                        </div>
                        {isRegistering && <span className="field-hint">At least 8 characters</span>}
                    </div>
                    <button type="submit" disabled={isLoading} className="login-btn">
                        {isLoading ? (
                            <span className="spinner"></span>
                        ) : (
                            isRegistering ? 'Get Started' : 'Enter Workspace'
                        )}
                    </button>
                </form>
                <div className="login-footer">
                    {isRegistering ? (
                        <p>Already have an account? <button onClick={() => { setIsRegistering(false); setError(''); }} className="link-btn">Sign in</button></p>
                    ) : (
                        <p>Don't have an account? <button onClick={() => { setIsRegistering(true); setError(''); }} className="link-btn">Sign up</button></p>
                    )}
                </div>
            </div>
        </div>
    );
}
