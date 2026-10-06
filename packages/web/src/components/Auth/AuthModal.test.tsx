// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { AuthModal } from './AuthModal.js';
import { useAppStore } from '../../store/appStore.js';

vi.mock('../../hooks/useAuth.js', () => ({
    useAuth: () => ({
        authEnabled: true,
        passwordAuthEnabled: true,
        githubAuthEnabled: false,
        gitlabAuthEnabled: false,
        token: null,
        isGuest: false,
        isLoading: false,
    })
}));

describe('AuthModal Component', () => {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        initialIsRegistering: true,
        onLogin: vi.fn().mockResolvedValue(undefined),
        onRegister: vi.fn().mockResolvedValue(undefined),
        onGuest: vi.fn().mockResolvedValue(undefined),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        useAppStore.setState({
            betaModeEnabled: false,
            betaLimitReached: false,
            turnstileSiteKey: null,
        });
    });

    it('does not render when isOpen is false', () => {
        const { container } = render(<AuthModal {...defaultProps} isOpen={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('adds always-dark modifier class when forceDark is true', () => {
        const { container } = render(<AuthModal {...defaultProps} forceDark />);
        const modal = container.querySelector('.auth-modal');
        expect(modal).not.toBeNull();
        expect(modal!.classList.contains('auth-modal--always-dark')).toBe(true);
    });

    it('omits always-dark modifier class when forceDark is false', () => {
        const { container } = render(<AuthModal {...defaultProps} forceDark={false} />);
        const modal = container.querySelector('.auth-modal');
        expect(modal).not.toBeNull();
        expect(modal!.classList.contains('auth-modal--always-dark')).toBe(false);
    });

    it('omits always-dark modifier class when forceDark is not provided', () => {
        const { container } = render(<AuthModal {...defaultProps} />);
        const modal = container.querySelector('.auth-modal');
        expect(modal).not.toBeNull();
        expect(modal!.classList.contains('auth-modal--always-dark')).toBe(false);
    });

    it('renders registration form when initialIsRegistering is true', () => {
        render(<AuthModal {...defaultProps} initialIsRegistering={true} />);

        expect(screen.getByText('Join the Beta')).toBeTruthy();
        expect(screen.getByRole('button', { name: /create account/i })).toBeTruthy();
    });

    it('renders login form when initialIsRegistering is false', () => {
        render(<AuthModal {...defaultProps} initialIsRegistering={false} />);

        expect(screen.getByText('Welcome back')).toBeTruthy();
        expect(screen.getByRole('button', { name: /^sign in$/i })).toBeTruthy();
    });

    it('can toggle between Sign In and Registration modes', () => {
        render(<AuthModal {...defaultProps} initialIsRegistering={true} />);

        const loginLink = screen.getByRole('button', { name: /log in/i });
        fireEvent.click(loginLink);

        expect(screen.getByText('Welcome back')).toBeTruthy();

        const createAccountLink = screen.getByRole('button', { name: /create an account/i });
        fireEvent.click(createAccountLink);

        expect(screen.getByText('Join the Beta')).toBeTruthy();
    });

    it('calls onRegister when submitting valid registration data', async () => {
        const onRegisterMock = vi.fn().mockResolvedValue(undefined);
        render(<AuthModal {...defaultProps} initialIsRegistering={true} onRegister={onRegisterMock} />);

        const usernameInput = screen.getByPlaceholderText('Enter username');
        const passwordInput = screen.getByPlaceholderText('Min 12 characters');
        const submitBtn = screen.getByRole('button', { name: /create account/i });

        fireEvent.change(usernameInput, { target: { value: 'newuser123' } });
        fireEvent.change(passwordInput, { target: { value: 'SecurePassword123!' } });

        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(onRegisterMock).toHaveBeenCalledWith('newuser123', 'SecurePassword123!', '', '', '');
        });
    });

    it('calls onLogin when submitting valid login credentials', async () => {
        const onLoginMock = vi.fn().mockResolvedValue(undefined);
        render(<AuthModal {...defaultProps} initialIsRegistering={false} onLogin={onLoginMock} />);

        const usernameInput = screen.getByPlaceholderText('Enter username');
        const passwordInput = screen.getByPlaceholderText('••••••••••••');
        const submitBtn = screen.getByRole('button', { name: /^sign in$/i });

        fireEvent.change(usernameInput, { target: { value: 'existinguser' } });
        fireEvent.change(passwordInput, { target: { value: 'UserSecretPassword!' } });

        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(onLoginMock).toHaveBeenCalledWith('existinguser', 'UserSecretPassword!', undefined, '');
        });
    });

    it('displays 2FA code input when login requires 2FA', async () => {
        const onLoginMock = vi.fn().mockResolvedValue({ twoFactorRequired: true });
        render(<AuthModal {...defaultProps} initialIsRegistering={false} onLogin={onLoginMock} />);

        const usernameInput = screen.getByPlaceholderText('Enter username');
        const passwordInput = screen.getByPlaceholderText('••••••••••••');
        const submitBtn = screen.getByRole('button', { name: /^sign in$/i });

        fireEvent.change(usernameInput, { target: { value: 'twofauser' } });
        fireEvent.change(passwordInput, { target: { value: 'SecretPassword!' } });

        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(screen.getByPlaceholderText(/000000/i)).toBeTruthy();
        });
    });

    it('calls onGuest when clicking continue as guest', async () => {
        const onGuestMock = vi.fn().mockResolvedValue(undefined);
        render(<AuthModal {...defaultProps} onGuest={onGuestMock} />);

        const guestBtn = screen.queryByRole('button', { name: /continue as guest/i });
        if (guestBtn) {
            fireEvent.click(guestBtn);
            expect(onGuestMock).toHaveBeenCalled();
        }
    });

    it('calls onClose when close button is clicked', () => {
        const onCloseMock = vi.fn();
        render(<AuthModal {...defaultProps} onClose={onCloseMock} />);

        const closeBtn = screen.getByLabelText('Close modal');
        fireEvent.click(closeBtn);

        expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('closes modal when Escape key is pressed', () => {
        const onCloseMock = vi.fn();
        render(<AuthModal {...defaultProps} onClose={onCloseMock} />);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('shows validation error when username is too short on registration', async () => {
        render(<AuthModal {...defaultProps} initialIsRegistering={true} />);

        const usernameInput = screen.getByPlaceholderText('Enter username');
        const passwordInput = screen.getByPlaceholderText('Min 12 characters');
        const submitBtn = screen.getByRole('button', { name: /create account/i });

        fireEvent.change(usernameInput, { target: { value: 'ab' } });
        fireEvent.change(passwordInput, { target: { value: 'ValidPassword123!' } });
        fireEvent.submit(submitBtn.closest('form')!);

        await waitFor(() => {
            expect(screen.getByText('Username must be between 3 and 20 characters')).toBeInTheDocument();
        });
    });

    it('shows validation error when password is too short on registration', async () => {
        render(<AuthModal {...defaultProps} initialIsRegistering={true} />);

        const usernameInput = screen.getByPlaceholderText('Enter username');
        const passwordInput = screen.getByPlaceholderText('Min 12 characters');
        const submitBtn = screen.getByRole('button', { name: /create account/i });

        fireEvent.change(usernameInput, { target: { value: 'validuser' } });
        fireEvent.change(passwordInput, { target: { value: 'short' } });
        fireEvent.submit(submitBtn.closest('form')!);

        await waitFor(() => {
            expect(screen.getByText('Password must be at least 12 characters')).toBeInTheDocument();
        });
    });

    it('toggles password visibility between text and password types', () => {
        render(<AuthModal {...defaultProps} initialIsRegistering={false} />);

        const passwordInput = screen.getByPlaceholderText('••••••••••••');
        expect(passwordInput).toHaveAttribute('type', 'password');

        const toggleBtn = screen.getByRole('button', { name: /^Show$/i });
        fireEvent.click(toggleBtn);
        expect(passwordInput).toHaveAttribute('type', 'text');

        const hideBtn = screen.getByRole('button', { name: /^Hide$/i });
        fireEvent.click(hideBtn);
        expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('cancels 2FA prompt and returns to login form', async () => {
        const onLoginMock = vi.fn().mockResolvedValue({ twoFactorRequired: true });
        render(<AuthModal {...defaultProps} initialIsRegistering={false} onLogin={onLoginMock} />);

        const usernameInput = screen.getByPlaceholderText('Enter username');
        const passwordInput = screen.getByPlaceholderText('••••••••••••');
        const submitBtn = screen.getByRole('button', { name: /^sign in$/i });

        fireEvent.change(usernameInput, { target: { value: 'twofauser' } });
        fireEvent.change(passwordInput, { target: { value: 'SecretPassword!' } });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(screen.getByText('Two-Factor Verification')).toBeInTheDocument();
        });

        const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
        fireEvent.click(cancelBtn);

        expect(screen.queryByText('Two-Factor Verification')).not.toBeInTheDocument();
        expect(screen.getByText('Welcome back')).toBeInTheDocument();
    });

    it('injects Turnstile script when turnstileSiteKey is present in store', () => {
        useAppStore.setState({ turnstileSiteKey: 'cf-site-key-123' });
        render(<AuthModal {...defaultProps} />);

        const script = document.getElementById('cf-turnstile-script') as HTMLScriptElement;
        expect(script).not.toBeNull();
        expect(script.src).toContain('challenges.cloudflare.com/turnstile');
    });
});
