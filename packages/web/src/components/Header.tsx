import { useState, useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';
import { useShallow } from 'zustand/react/shallow';
import { UserMenu } from './UserMenu.js';
import { useToast } from '../hooks/useToast.js';

interface Props {
    onToggleSidebar?: () => void;
    theme: 'dark' | 'light';
    onToggleTheme: () => void;
    authEnabled?: boolean;
    token?: string | null;
    isGuest?: boolean;
    onLogout?: () => void;
}

export function Header({
    onToggleSidebar,
    theme,
    onToggleTheme,
    authEnabled = false,
    token = null,
    isGuest = false,
    onLogout,
}: Props) {
    const { isRunning, isPaused, isLoadingSpecs, isQueued, activeTab } = useAppStore(useShallow(state => ({
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        isLoadingSpecs: state.isLoadingSpecs,
        isQueued: state.isQueued,
        activeTab: state.activeTab,
    })));

    const isBusy = isRunning || isLoadingSpecs || isQueued;

    const { showToast } = useToast();

    const [invitations, setInvitations] = useState<any[]>([]);

    useEffect(() => {
        if (!authEnabled || !token || isGuest) return;

        const fetchInvitations = async () => {
            try {
                const res = await fetch('/api/auth/invitations', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setInvitations(data.invitations || []);
                }
            } catch (err) {
                console.error(err);
            }
        };

        fetchInvitations();
        const interval = setInterval(fetchInvitations, 10000);
        return () => clearInterval(interval);
    }, [authEnabled, token, isGuest]);

    const handleAcceptInvite = async (inviteToken: string) => {
        try {
            const res = await fetch('/api/auth/invitations/accept', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token: inviteToken })
            });
            if (res.ok) {
                const data = await res.json();
                setInvitations(invs => invs.filter(i => i.token !== inviteToken));
                window.dispatchEvent(new CustomEvent('swazz:invite-accepted', { detail: { projectId: data.project_id } }));
            } else {
                const data = await res.json();
                showToast(`Failed to accept invitation: ${data.error}`, 'error');
            }
        } catch (err) {
            showToast('Failed to accept invitation', 'error');
        }
    };

    const handleDeclineInvite = async (inviteToken: string) => {
        try {
            const res = await fetch('/api/auth/invitations/decline', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token: inviteToken })
            });
            if (res.ok) {
                setInvitations(invs => invs.filter(i => i.token !== inviteToken));
                showToast('Invitation declined', 'success');
            } else {
                const data = await res.json();
                showToast(`Failed to decline invitation: ${data.error}`, 'error');
            }
        } catch (err) {
            showToast('Failed to decline invitation', 'error');
        }
    };



    return (
        <header className="header">
            {/* Left Section: Logo, Status, Toggles */}
            <div className="header-left">
                {/* Left Toggle (Mobile) */}
                <button className="header-mobile-toggle" onClick={onToggleSidebar} title="Menu" aria-label="Toggle Menu">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
                    </svg>
                </button>

                <div 
                    className="header-logo header-cursor-pointer"
                    onClick={() => useAppStore.setState({ activeTab: 'heatmap' })}
                >
                    <div className="header-logo-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                        </svg>
                    </div>
                    <span className="header-logo-text">Swazz</span>
                </div>

                <div className="header-divider" />

                {/* Running status pill */}
                {isBusy && (
                    <div className={`header-status${isLoadingSpecs ? ' loading' : isPaused ? ' paused' : isQueued ? ' queued' : ''}`}>
                        {isLoadingSpecs ? (
                            <>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="header-spin-icon">
                                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                                </svg>
                                Loading specs…
                            </>
                        ) : isPaused ? (
                            <>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                                </svg>
                                Paused
                            </>
                        ) : isQueued ? (
                            <>
                                <span className="queued-dot" />
                                Queued
                            </>
                        ) : (
                            <>
                                <span className="running-dot" />
                                Running
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Center Section: Guest Mode conversion banner */}
            {authEnabled && isGuest && (
                <div 
                    className="header-guest-banner guest-badge" 
                    onClick={onLogout} 
                    title="Temporary guest account. Data is automatically deleted after 24 hours."
                >
                    <span className="header-guest-alert-dot" />
                    <span className="header-guest-banner-text">
                        🛡️ <strong>Guest Mode:</strong> Results are temporary. <strong>Register a free account</strong> to save history, download PDF reports & add webhooks. <span className="header-guest-register-link">Register Now →</span>
                    </span>
                </div>
            )}

            <div className="header-right">
                {/* Theme Toggle */}
                <button className="btn btn-ghost btn-icon" onClick={onToggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label="Toggle Theme">
                    {theme === 'dark' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.07" x2="5.64" y2="17.66"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                        </svg>
                    )}
                </button>

                {authEnabled && isGuest && (
                    <button 
                        className="btn btn-primary sign-up-btn" 
                        onClick={onLogout} 
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="8.5" cy="7" r="4"></circle>
                            <line x1="20" y1="8" x2="20" y2="14"></line>
                            <line x1="23" y1="11" x2="17" y2="11"></line>
                        </svg>
                        <span className="sign-up-text">Sign Up</span>
                    </button>
                )}

                {authEnabled && token && (
                    <div className="header-flex-center">
                        {invitations.length > 0 && (
                            <div className="header-invitation-banner">
                                <span>You've been invited to <strong>{invitations[0].project_name}</strong></span>
                                <button className="btn btn-primary header-accept-btn" onClick={() => handleAcceptInvite(invitations[0].token)}>Accept</button>
                                <button className="btn btn-secondary header-decline-btn" onClick={() => handleDeclineInvite(invitations[0].token)}>Decline</button>
                            </div>
                        )}
                        <UserMenu onLogout={onLogout || (() => {})} />
                    </div>
                )}
            </div>

            {isBusy && !isLoadingSpecs && (
                <div className="header-progress-container">
                    <div className="header-progress-bar" />
                </div>
            )}
            <style>
                {`
                @keyframes progress-indeterminate {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(400%); }
                }
                `}
            </style>
        </header>
    );
}
