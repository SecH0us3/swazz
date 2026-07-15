import { useState } from 'react';
import type { SwazzConfig, FuzzingProfile } from '../../types.js';
import { Section, KVEditor } from './Shared.js';
import { useAppStore } from '../../store/appStore.js';
import { PayloadSettingsModal } from './PayloadSettingsModal.js';

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

            <div style={{ padding: '16px 0 0 0', borderTop: '1px solid var(--border-default)', marginTop: '16px', display: 'flex', flexDirection: 'column' }}>
                <button
                    className="btn btn-secondary"
                    style={{ width: '100%', justifyContent: 'center', gap: '8px' }}
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
