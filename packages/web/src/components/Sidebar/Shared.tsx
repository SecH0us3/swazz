import React, { useState } from 'react';

// ─── Collapsible Section ────────────────────────────────

export function Section({ title, defaultOpen = true, count, children }: { title: string; defaultOpen?: boolean; count?: number; children: React.ReactNode }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="sidebar-section">
            <div
                className="sidebar-section-header"
                data-collapsed={!open}
                onClick={() => setOpen(!open)}
            >
                <span>
                    {title}
                    {count !== undefined && count > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-disabled)', fontWeight: 400 }}>({count})</span>
                    )}
                </span>
                <span className="chevron">▼</span>
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
}: {
    entries: Record<string, string>;
    onChange: (entries: Record<string, string>) => void;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
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
        const key = `new-${Date.now()}`;
        onChange({ ...entries, [key]: '' });
    };

    return (
        <div className="kv-editor">
            {pairs.map(([key, value], i) => (
                <div key={i} className="kv-row">
                    <input
                        className="input"
                        value={key}
                        placeholder={keyPlaceholder}
                        onChange={(e) => update(key, e.target.value, value)}
                    />
                    <input
                        className="input"
                        value={value}
                        placeholder={valuePlaceholder}
                        onChange={(e) => update(key, key, e.target.value)}
                    />
                    <button className="kv-delete" onClick={() => remove(key)} title="Delete">
                        ✕
                    </button>
                </div>
            ))}
            <button className="kv-add" onClick={add}>
                + Add {keyPlaceholder}
            </button>
        </div>
    );
}
