import { ReactNode, useState } from 'react';

// ─── Collapsible Section ────────────────────────────────

export function Section({
    title,
    defaultOpen = true,
    count,
    action,
    children,
}: {
    title: string;
    defaultOpen?: boolean;
    count?: number;
    action?: ReactNode;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="sidebar-section">
            <div
                className="sidebar-section-header"
                data-collapsed={!open}
                onClick={() => setOpen(!open)}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpen(!open);
                    }
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ display:'flex', alignItems:'center' }}>
                        <span className="chevron" style={{ marginRight: 6 }}>{open ? '▼' : '▶'}</span>
                        {title}
                        {count !== undefined && count > 0 && (
                            <span className="section-count">{count}</span>
                        )}
                    </span>
                    {action}
                </div>
            </div>
            <div className="sidebar-section-content" data-collapsed={!open || undefined}>
                {children}
            </div>
        </div>
    );
}

// ─── Key-Value Editor ───────────────────────────────────

export function KVEditor({
    entries,
    onChange,
    keyPlaceholder = 'Key',
    valuePlaceholder = 'Value',
    authKeys,
    onToggleAuthKey,
}: {
    entries: Record<string, string>;
    onChange: (entries: Record<string, string>) => void;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    authKeys?: string[];
    onToggleAuthKey?: (key: string) => void;
}) {
    const pairs = Object.entries(entries);

    const update = (oldKey: string, newKey: string, value: string) => {
        const next = { ...entries };
        if (oldKey !== newKey) delete next[oldKey];
        next[newKey] = value;
        onChange(next);
    };

    const remove = (key: string) => {
        const next = { ...entries };
        delete next[key];
        onChange(next);
    };

    const add = () => {
        onChange({ ...entries, [`new-${Date.now()}`]: '' });
    };

    return (
        <div className="kv-editor">
            {pairs.map(([key, value], i) => {
                const isAuth = authKeys && authKeys.some(x => x.toLowerCase() === key.toLowerCase());
                return (
                    <div key={i} className="kv-row" style={authKeys ? { gridTemplateColumns: '1fr 1fr 24px 22px' } : undefined}>
                        <input
                            className="input"
                            value={key}
                            placeholder={keyPlaceholder}
                            aria-label={keyPlaceholder}
                            onChange={(e) => update(key, e.target.value, value)}
                        />
                        <input
                            className="input"
                            value={value}
                            placeholder={valuePlaceholder}
                            aria-label={valuePlaceholder}
                            onChange={(e) => update(key, key, e.target.value)}
                        />
                        {authKeys && onToggleAuthKey && (
                            <button
                                className={`kv-auth-toggle ${isAuth ? 'is-auth' : ''}`}
                                onClick={() => onToggleAuthKey(key)}
                                title={isAuth ? "Auth Token: drops for Anonymous scan and switches for User B BOLA scan." : "Mark as Auth Token (session/cookie/header)"}
                                type="button"
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: isAuth ? 1 : 0.35,
                                    transition: 'opacity var(--duration-fast)',
                                    padding: 0
                                }}
                            >
                                {isAuth ? '🔒' : '🔓'}
                            </button>
                        )}
                        <button className="kv-delete" onClick={() => remove(key)} title="Delete" aria-label={`Delete ${key || 'entry'}`}>✕</button>
                    </div>
                );
            })}
            <button className="kv-add" onClick={add}>+ Add {keyPlaceholder}</button>
        </div>
    );
}
