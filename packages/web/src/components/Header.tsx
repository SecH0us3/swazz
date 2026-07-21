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
    onOpenRegisterModal?: () => void;
    baseUrl?: string;
    onChangeBaseUrl?: (url: string) => void;
    onStart?: (cleanUrl?: string) => void;
    onStop?: () => void;
    onPause?: () => void;
    onResume?: () => void;
    onToggleConfig?: () => void;
}

export function Header({
    onToggleSidebar,
    theme,
    onToggleTheme,
    authEnabled = false,
    token = null,
    isGuest = false,
    onLogout,
    onOpenRegisterModal,
    baseUrl = '',
    onChangeBaseUrl,
    onStart,
    onStop,
    onPause,
    onResume,
    onToggleConfig,
}: Props) {
    const { isRunning, isPaused, isLoadingSpecs, isQueued, activeTab, betaModeEnabled, loadedRunId, isConfigOpen, isConfigHiddenDesktop } = useAppStore(useShallow(state => ({
        isRunning: state.isRunning,
        isPaused: state.isPaused,
        isLoadingSpecs: state.isLoadingSpecs,
        isQueued: state.isQueued,
        activeTab: state.activeTab,
        betaModeEnabled: state.betaModeEnabled,
        loadedRunId: state.loadedRunId,
        isConfigOpen: state.isConfigOpen,
        isConfigHiddenDesktop: state.isConfigHiddenDesktop,
    })));

    const isConfigPanelOpen = typeof window !== 'undefined' && window.innerWidth <= 768 ? isConfigOpen : !isConfigHiddenDesktop;
    const isBusy = isRunning || isLoadingSpecs || isQueued;

    const { showToast } = useToast();

    const [invitations, setInvitations] = useState<any[]>([]);
    const [localUrl, setLocalUrl] = useState(baseUrl);

    useEffect(() => {
        setLocalUrl(baseUrl);
    }, [baseUrl]);

    const handleUrlCommit = (val: string) => {
        let cleanUrl = val.trim();
        if (!cleanUrl) {
            if (onChangeBaseUrl) onChangeBaseUrl('');
            setLocalUrl('');
            return;
        }

        try {
            const u = new URL(cleanUrl);
            cleanUrl = u.origin;
        } catch {
            // Not a full URL, leave as is
        }

        setLocalUrl(cleanUrl);
        if (onChangeBaseUrl && cleanUrl !== baseUrl) {
            onChangeBaseUrl(cleanUrl);
        }
    };

    const handleStartClick = () => {
        let cleanUrl = localUrl.trim();
        if (cleanUrl) {
            try {
                const u = new URL(cleanUrl);
                cleanUrl = u.origin;
            } catch {
                // Not a full URL, leave as is
            }
        }
        if (onChangeBaseUrl) {
            onChangeBaseUrl(cleanUrl);
        }
        if (onStart) {
            onStart(cleanUrl);
        }
    };

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
            {/* Left Section: Logo, Beta Badge, Status Pill */}
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

                {betaModeEnabled && (
                    <div 
                        className="header-beta-badge" 
                        title="Closed Beta Phase: System capacity is currently limited. Signups are subject to invite controls."
                    >
                        <span className="header-beta-dot" />
                        <span className="header-beta-text">Closed Beta</span>
                    </div>
                )}

                <div className="header-divider" />

                {/* Running status pill */}
                {(isRunning || isPaused || isQueued) && (
                    <div className={`header-status${isPaused ? ' paused' : isQueued ? ' queued' : ''}`}>
                        {isPaused ? (
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

            {/* Center Section: Target API URL & Scan Controls */}
            {loadedRunId === null && (
                <div className="header-center">
                    <div className="header-url-section">
                        <svg className="url-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="2" y1="12" x2="22" y2="12"/>
                            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
                        </svg>
                        <input
                            className="workspace-target-input header-target-input"
                            value={localUrl}
                            aria-label="Target API URL"
                            onChange={(e) => setLocalUrl(e.target.value)}
                            onBlur={() => handleUrlCommit(localUrl)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleUrlCommit(localUrl);
                                    e.currentTarget.blur();
                                }
                            }}
                            placeholder="Enter target API URL (e.g. https://api.example.com)"
                            readOnly={!onChangeBaseUrl}
                        />
                        {isBusy && !isLoadingSpecs && (
                            <span className="workspace-status-indicator" />
                        )}
                    </div>

                    <div className="header-action-section">
                        {!isBusy ? (
                            <button className="btn btn-primary btn-run" id="btn-start" onClick={handleStartClick}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5,3 19,12 5,21"/>
                                </svg>
                                <span>Run Scan</span>
                            </button>
                        ) : (
                            <div className="action-button-group">
                                {!isLoadingSpecs && (
                                    isPaused ? (
                                        <button className="btn btn-success" onClick={onResume} title="Resume">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                                <polygon points="5,3 19,12 5,21"/>
                                            </svg>
                                            <span>Resume</span>
                                        </button>
                                    ) : (
                                        <button className="btn btn-ghost" onClick={onPause} title="Pause">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                                <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                                            </svg>
                                            <span>Pause</span>
                                        </button>
                                    )
                                )}
                                <button className="btn btn-danger" onClick={onStop} title="Stop">
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                                    </svg>
                                    <span>Stop</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Right Section: Theme Toggle & Guest Unified Button / User Menu */}
            <div className="header-right">
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

                {authEnabled && isGuest ? (
                    <button 
                        className="header-guest-unified-btn guest-badge sign-up-btn" 
                        onClick={() => onOpenRegisterModal ? onOpenRegisterModal() : onLogout?.()} 
                        title="Temporary guest session. Scans & history are automatically deleted after 24 hours. Click to Sign Up."
                    >
                        <span className="guest-alert-dot" />
                        <span className="header-guest-pill-text">Guest Mode</span>
                        <span className="header-guest-divider">•</span>
                        <span className="header-guest-action">Sign Up →</span>
                    </button>
                ) : authEnabled && token ? (
                    <div className="header-flex-center">
                        {invitations.length > 0 && (
                            <div className="header-invitation-banner">
                                <span>You've been invited to <strong>{invitations[0].project_name}</strong></span>
                                <button className="btn btn-primary header-accept-btn" onClick={() => handleAcceptInvite(invitations[0].token)}>Accept</button>
                                <button className="btn btn-secondary header-decline-btn" onClick={() => handleDeclineInvite(invitations[0].token)}>Decline</button>
                            </div>
                        )}
                        <UserMenu onLogout={onLogout || (() => {})} isGuest={isGuest} />
                    </div>
                ) : null}
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
