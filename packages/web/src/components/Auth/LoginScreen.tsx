import { useState } from 'react';
import './LoginScreen.css';

interface LoginScreenProps {
    onLogin: (email: string, password: string) => Promise<void>;
    onRegister: (email: string, password: string) => Promise<void>;
}

export function LoginScreen({ onLogin, onRegister }: LoginScreenProps) {
    const [isRegistering, setIsRegistering] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);
        try {
            if (isRegistering) {
                await onRegister(email, password);
            } else {
                await onLogin(email, password);
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
                        <label>Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                        />
                    </div>
                    <button type="submit" disabled={isLoading} className="login-btn">
                        {isLoading ? 'Loading...' : (isRegistering ? 'Sign Up' : 'Sign In')}
                    </button>
                </form>
                <div className="login-footer">
                    {isRegistering ? (
                        <p>Already have an account? <button onClick={() => setIsRegistering(false)} className="link-btn">Sign in</button></p>
                    ) : (
                        <p>Don't have an account? <button onClick={() => setIsRegistering(true)} className="link-btn">Sign up</button></p>
                    )}
                </div>
            </div>
        </div>
    );
}
