import { ChainingRule } from '../../types.js';

interface Props {
    rules: ChainingRule[];
    onChange: (rules: ChainingRule[]) => void;
}

export function ChainingRulesEditor({ rules, onChange }: Props) {
    const addRule = () => {
        onChange([
            ...rules,
            {
                source_endpoint: '',
                extract_type: 'json',
                extract_path: '',
                variable_name: ''
            }
        ]);
    };

    const updateRule = (index: number, partial: Partial<ChainingRule>) => {
        const next = [...rules];
        next[index] = { ...next[index], ...partial };
        onChange(next);
    };

    const deleteRule = (index: number) => {
        const next = [...rules];
        next.splice(index, 1);
        onChange(next);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {rules.map((rule, i) => (
                <div key={i} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-3)',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--text-secondary)' }}>Rule {i + 1}</span>
                        <button 
                            className="btn btn-ghost" 
                            style={{ padding: '4px', height: 'auto', minHeight: '0' }}
                            onClick={() => deleteRule(i)}
                            title="Delete Rule"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>Source Endpoint</label>
                        <input
                            className="input"
                            placeholder="e.g. POST /api/login"
                            value={rule.source_endpoint}
                            onChange={(e) => updateRule(i, { source_endpoint: e.target.value })}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flex: 1 }}>
                            <label style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>Extract Type</label>
                            <select
                                className="input"
                                value={rule.extract_type}
                                onChange={(e) => updateRule(i, { extract_type: e.target.value as 'json' | 'header' | 'regex' })}
                            >
                                <option value="json">JSON Body</option>
                                <option value="header">Response Header</option>
                                <option value="regex">Regex</option>
                            </select>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flex: 1 }}>
                            <label style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>Variable Name</label>
                            <input
                                className="input"
                                placeholder="e.g. AUTH_TOKEN"
                                value={rule.variable_name}
                                onChange={(e) => updateRule(i, { variable_name: e.target.value })}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        <label style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--text-muted)' }}>Extract Path / Regex</label>
                        <input
                            className="input"
                            placeholder={rule.extract_type === 'json' ? "e.g. data.token" : rule.extract_type === 'header' ? "e.g. Authorization" : "e.g. token=([a-z0-9]+)"}
                            value={rule.extract_path}
                            onChange={(e) => updateRule(i, { extract_path: e.target.value })}
                        />
                    </div>
                </div>
            ))}
            <button className="btn" style={{ width: '100%', background: 'var(--bg-surface)', border: '1px dashed var(--border-hover)' }} onClick={addRule}>
                + Add Rule
            </button>
        </div>
    );
}
