import type { SwazzConfig, FuzzingProfile } from '../../types.js';
import { Section, KVEditor } from './Shared.js';
import { useAppStore } from '../../store/appStore.js';

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
        </aside>
    );
}
