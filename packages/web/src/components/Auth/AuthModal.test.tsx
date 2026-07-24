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

    it('calls onClose when close button is clicked', () => {
        const onCloseMock = vi.fn();
        render(<AuthModal {...defaultProps} onClose={onCloseMock} />);

        const closeBtn = screen.getByLabelText('Close modal');
        fireEvent.click(closeBtn);

        expect(onCloseMock).toHaveBeenCalledTimes(1);
    });
});
