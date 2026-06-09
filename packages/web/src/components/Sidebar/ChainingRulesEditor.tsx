import { ChainingRule } from '../../types.js';
import './ChainingRulesEditor.css';

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
        <div className="chaining-rules-container">
            {rules.map((rule, i) => (
                <div key={i} className="chaining-rule-card">
                    <div className="chaining-rule-header">
                        <span className="chaining-rule-title">Rule {i + 1}</span>
                        <button 
                            className="btn btn-ghost chaining-rule-delete-btn" 

                            onClick={() => deleteRule(i)}
                            title="Delete Rule"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                        </button>
                    </div>

                    <div className="chaining-rule-field">
                        <label>Source Endpoint</label>
                        <input
                            className="input"
                            placeholder="e.g. POST /api/login"
                            value={rule.source_endpoint}
                            onChange={(e) => updateRule(i, { source_endpoint: e.target.value })}
                        />
                    </div>

                    <div className="chaining-rule-row">
                        <div className="chaining-rule-col">
                            <label>Extract Type</label>
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
                        
                        <div className="chaining-rule-col">
                            <label>Variable Name</label>
                            <input
                                className="input"
                                placeholder="e.g. AUTH_TOKEN"
                                value={rule.variable_name}
                                onChange={(e) => updateRule(i, { variable_name: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="chaining-rule-field">
                        <label>Extract Path / Regex</label>
                        <input
                            className="input"
                            placeholder={rule.extract_type === 'json' ? "e.g. data.token" : rule.extract_type === 'header' ? "e.g. Authorization" : "e.g. token=([a-z0-9]+)"}
                            value={rule.extract_path}
                            onChange={(e) => updateRule(i, { extract_path: e.target.value })}
                        />
                    </div>
                </div>
            ))}
            <button className="btn chaining-rule-add-btn" onClick={addRule}>
                + Add Rule
            </button>
        </div>
    );
}
