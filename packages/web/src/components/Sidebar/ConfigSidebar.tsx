import { useState, useEffect } from 'react';
import type { SwazzConfig, FuzzingProfile } from '../../types.js';
import { Section, KVEditor } from './Shared.js';
import { useAppStore } from '../../store/appStore.js';
import { PayloadSettingsModal } from './PayloadSettingsModal.js';
import { useEncryption } from '../../hooks/useEncryption.js';

interface Props {
    style?: React.CSSProperties;
    config: SwazzConfig;
    onUpdateHeaders: (h: Record<string, string>) => void;
    onUpdateCookies: (c: Record<string, string>) => void;
    onUpdateProfiles: (p: FuzzingProfile[]) => void;
    onUpdateConfig: (partial: Partial<SwazzConfig>) => void;
    className?: string;
}

const ALL_PROFILES: FuzzingProfile[] = ['RANDOM', 'BOUNDARY', 'MALICIOUS'];
const PROFILE_LABELS: Record<string, string> = {
    RANDOM: 'Random values',
    BOUNDARY: 'Boundary values',
    MALICIOUS: 'Injection attacks',
};

export function ConfigSidebar({
    style,
    config,
    onUpdateHeaders,
    onUpdateCookies,
    onUpdateProfiles,
    onUpdateConfig,
    className,
}: Props) {
    const activeProfiles = config.settings.profiles || [];
    const [showPayloadSettings, setShowPayloadSettings] = useState(false);

    const activeProject = useAppStore(state => state.activeProject);
    const encryption = useEncryption(activeProject?.id);
    const { hasKeyPair, exportAsJwk } = encryption;

    const safeGetItem = (key: string): string | null => {
        try { return localStorage.getItem(key); } catch { return null; }
    };
    const safeSetItem = (key: string, value: string): void => {
        try { localStorage.setItem(key, value); } catch { /* no-op in test/SSR environments */ }
    };

    const [backupStatus, setBackupStatus] = useState<string | null>(() => {
        if (!activeProject) return null;
        return safeGetItem('swazz-key-backup-status:' + activeProject.id);
    });

    useEffect(() => {
        if (activeProject) {
            setBackupStatus(safeGetItem('swazz-key-backup-status:' + activeProject.id));
        } else {
            setBackupStatus(null);
        }
    }, [activeProject?.id]);

    const handleDownloadBackup = async () => {
        if (!activeProject) return;
        try {
            const jwk = await exportAsJwk();
            if (!jwk) return;
            const blob = new Blob([JSON.stringify(jwk, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.swazzkey`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            safeSetItem('swazz-key-backup-status:' + activeProject.id, 'saved');
            setBackupStatus('saved');
        } catch (err) {
            console.error('Failed to download backup:', err);
        }
    };

    const toggleProfile = (p: FuzzingProfile) => {
        const isActive = activeProfiles.includes(p);
        const next = isActive ? activeProfiles.filter((x) => x !== p) : [...activeProfiles, p];
        if (next.length > 0) onUpdateProfiles(next);
    };

    return (
        <aside className={`config-sidebar ${className || ''}`} style={{ gridArea: 'unset', borderLeft: '1px solid var(--border-subtle)', borderRight: 'none', ...style }}>
            {/* Profiles */}
            <Section title="Profiles">
                <div className="profile-toggles">
                    {ALL_PROFILES.map((p) => {
                        const isActive = activeProfiles.includes(p);
                        return (
                            <div
                                key={p}
                                className={`profile-toggle ${p.toLowerCase()} ${isActive ? 'active' : ''}`}
                                onClick={() => toggleProfile(p)}
                            >
                                <span className="dot" />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 500, color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                                        {p.charAt(0) + p.slice(1).toLowerCase()}
                                    </div>
                                    <div style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)', marginTop: 1 }}>
                                        {PROFILE_LABELS[p]}
                                    </div>
                                </div>
                                {isActive && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                                        <polyline points="20 6 9 17 4 12"/>
                                    </svg>
                                )}
                            </div>
                        );
                    })}
                </div>
                <button
                    className="btn btn-ghost payload-settings-trigger"
                    onClick={() => setShowPayloadSettings(true)}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                    Customize Payloads
                </button>
            </Section>

            {/* Headers */}
            <Section
                title="Headers (User A / Primary Session)"
                count={Object.keys(config.global_headers || {}).length}
                defaultOpen={Object.keys(config.global_headers || {}).length > 0}
            >
                <KVEditor
                    entries={config.global_headers || {}}
                    onChange={onUpdateHeaders}
                    keyPlaceholder="Header"
                    valuePlaceholder="Value"
                    authKeys={config.settings.auth_headers}
                    onToggleAuthKey={(key) => {
                        const current = config.settings.auth_headers || [];
                        const lowerKey = key.toLowerCase();
                        const next = current.some(x => x.toLowerCase() === lowerKey)
                            ? current.filter(x => x.toLowerCase() !== lowerKey)
                            : [...current, key];
                        onUpdateConfig({
                            settings: { ...config.settings, auth_headers: next }
                        });
                    }}
                />
            </Section>

            {/* Cookies */}
            <Section
                title="Cookies (User A / Primary Session)"
                count={Object.keys(config.cookies || {}).length}
                defaultOpen={Object.keys(config.cookies || {}).length > 0}
            >
                <KVEditor
                    entries={config.cookies || {}}
                    onChange={onUpdateCookies}
                    keyPlaceholder="Name"
                    valuePlaceholder="Value"
                    authKeys={config.settings.auth_cookies}
                    onToggleAuthKey={(key) => {
                        const current = config.settings.auth_cookies || [];
                        const lowerKey = key.toLowerCase();
                        const next = current.some(x => x.toLowerCase() === lowerKey)
                            ? current.filter(x => x.toLowerCase() !== lowerKey)
                            : [...current, key];
                        onUpdateConfig({
                            settings: { ...config.settings, auth_cookies: next }
                        });
                    }}
                />
            </Section>

            {/* BOLA / Multi-Identity */}
            <Section title="BOLA / Multi-Identity" count={config.settings.bola_testing ? 1 : 0}>
                <label className="premium-checkbox-label">
                    <input
                        type="checkbox"
                        className="premium-checkbox"
                        checked={config.settings.bola_testing ?? false}
                        onChange={() => onUpdateConfig({
                            settings: {
                                ...config.settings,
                                bola_testing: !(config.settings.bola_testing ?? false)
                            }
                        })}
                    />
                    <strong style={{ fontSize: 'var(--font-size-sm)' }}>Enable BOLA Checking</strong>
                </label>
                <div className="bola-description">
                    Compare primary user endpoints against credentials of User B to detect access control bypasses.
                </div>

                {(config.settings.bola_testing ?? false) && (
                    <div className="bola-editors-container">
                        {/* Lock warning */}
                        {(!config.settings.auth_headers || config.settings.auth_headers.length === 0) &&
                         (!config.settings.auth_cookies || config.settings.auth_cookies.length === 0) && (
                            <div className="bola-warning-box">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="bola-warning-icon">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                                    <line x1="12" y1="9" x2="12" y2="13"/>
                                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                                </svg>
                                <span>No authentication credentials marked above. Click headers/cookies lock icons to identify tokens to switch.</span>
                            </div>
                        )}

                        {/* User B Card */}
                        <div className="bola-identity-card">
                            <div className="bola-identity-badge">User B (Secondary)</div>
                            
                            <div className="bola-sub-title-top">Headers (User B)</div>
                            <KVEditor
                                entries={config.auth_identities?.userB?.headers || {}}
                                onChange={(h) => {
                                    const currentIdentities = config.auth_identities || {};
                                    const currentB = currentIdentities.userB || { headers: {}, cookies: {} };
                                    onUpdateConfig({
                                        auth_identities: {
                                            ...currentIdentities,
                                            userB: {
                                                ...currentB,
                                                headers: h
                                            }
                                        }
                                    });
                                }}
                                keyPlaceholder="Header"
                                valuePlaceholder="Value"
                            />

                            <div className="bola-sub-title">Cookies (User B)</div>
                            <KVEditor
                                entries={config.auth_identities?.userB?.cookies || {}}
                                onChange={(c) => {
                                    const currentIdentities = config.auth_identities || {};
                                    const currentB = currentIdentities.userB || { headers: {}, cookies: {} };
                                    onUpdateConfig({
                                        auth_identities: {
                                            ...currentIdentities,
                                            userB: {
                                                ...currentB,
                                                cookies: c
                                            }
                                        }
                                    });
                                }}
                                keyPlaceholder="Name"
                                valuePlaceholder="Value"
                            />
                        </div>
                    </div>
                )}
            </Section>

            {/* E2EE Key Backup Status */}
            {hasKeyPair && activeProject && (
                <Section title="Encryption (E2EE)">
                    {backupStatus === 'saved' ? (
                        <div className="e2ee-sidebar-status e2ee-sidebar-status--ok">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                <polyline points="9 12 11 14 15 10" />
                            </svg>
                            <span>Reports encrypted &amp; key backed up</span>
                        </div>
                    ) : (
                        <div className="e2ee-sidebar-nudge">
                            <div className="e2ee-sidebar-nudge-header">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="e2ee-sidebar-nudge-icon">
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </svg>
                                <strong>Backup your encryption key</strong>
                            </div>
                            <p className="e2ee-sidebar-nudge-desc">
                                Scan reports are E2EE — only your browser can decrypt them. Save a backup to avoid losing access.
                            </p>
                            <button
                                className="btn btn-primary e2ee-sidebar-nudge-btn"
                                onClick={handleDownloadBackup}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                    <polyline points="7 10 12 15 17 10" />
                                    <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                Download .swazzkey
                            </button>
                            <button
                                className="btn btn-ghost e2ee-sidebar-nudge-more"
                                onClick={() => useAppStore.setState({ activeTab: 'project_settings' })}
                            >
                                More key options →
                            </button>
                        </div>
                    )}
                </Section>
            )}

            <div className="config-sidebar-footer">
                <button
                    className="btn btn-secondary"
                    onClick={() => useAppStore.setState({ activeTab: 'project_settings' })}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                    More Project Settings
                </button>
            </div>
            {showPayloadSettings && (
                <PayloadSettingsModal onClose={() => setShowPayloadSettings(false)} />
            )}
        </aside>
    );
}
