import React from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { AuthStep } from '../../types.js';
import '../Sidebar/ChainingRulesEditor.css';

export function AuthSequenceTab() {
    const { config, updateConfig } = useConfig();
    const authSequence = config.auth_sequence || [];

    const handleAddStep = () => {
        const next = [...authSequence, { type: 'request', method: 'POST', url: '', headers: {}, body: '', extract_variables: {} } as const satisfies AuthStep];
        updateConfig({ auth_sequence: next });
    };

    const handleUpdateStep = (index: number, partial: Partial<AuthStep>) => {
        const next = [...authSequence];
        const updated = { ...next[index], ...partial };
        if (partial.type === 'totp') {
            delete updated.method;
            delete updated.url;
            delete updated.headers;
            delete updated.body;
        } else if (partial.type === 'request') {
            delete updated.totp_secret;
            delete updated.totp_variable;
            updated.method = updated.method || 'POST';
        }
        next[index] = updated;
        updateConfig({ auth_sequence: next });
    };

    const handleDeleteStep = (index: number) => {
        const next = [...authSequence];
        next.splice(index, 1);
        updateConfig({ auth_sequence: next });
    };

    return (
        <div className="card project-settings-card">
            <h2 className="project-settings-title-tab">Authentication Sequence</h2>
            <p className="project-settings-desc-tab">
                Configure a sequence of requests or operations to authenticate before scanning.
            </p>

            <div className="chaining-rules-container">
                {authSequence.map((step, i) => {
                    const stepType = step.type || 'request';
                    return (
                        <div key={i} className="chaining-rule-card">
                            <div className="chaining-rule-header">
                                <span className="chaining-rule-title">Step {i + 1}</span>
                                <button 
                                    className="btn btn-ghost chaining-rule-delete-btn" 
                                    onClick={() => handleDeleteStep(i)}
                                    title="Delete Step"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 6L6 18M6 6l12 12"/>
                                    </svg>
                                </button>
                            </div>
                            
                            <div className="chaining-rule-field">
                                <label className="settings-field-label">Step Type</label>
                                <select
                                    className="input settings-field-input"
                                    value={stepType}
                                    onChange={(e) => handleUpdateStep(i, { type: e.target.value })}
                                >
                                    <option value="request">HTTP Request</option>
                                    <option value="totp">TOTP Generator</option>
                                </select>
                            </div>

                            {stepType === 'totp' ? (
                                <>
                                    <div className="chaining-rule-field">
                                        <label className="settings-field-label">TOTP Secret / URI</label>
                                        <input
                                            className="input settings-field-input"
                                            value={step.totp_secret || ''}
                                            onChange={(e) => handleUpdateStep(i, { totp_secret: e.target.value })}
                                            placeholder="JBSWY3DPEHPK3PXP"
                                            data-1p-ignore
                                        />
                                    </div>
                                    <div className="chaining-rule-field">
                                        <label className="settings-field-label">Variable Name</label>
                                        <input
                                            className="input settings-field-input"
                                            value={step.totp_variable || ''}
                                            onChange={(e) => handleUpdateStep(i, { totp_variable: e.target.value })}
                                            placeholder="totp_code"
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="chaining-rule-row">
                                        <div className="chaining-rule-col">
                                            <label className="settings-field-label">Method</label>
                                            <select
                                                className="input settings-field-input"
                                                value={step.method || 'POST'}
                                                onChange={(e) => handleUpdateStep(i, { method: e.target.value })}
                                            >
                                                <option value="GET">GET</option>
                                                <option value="POST">POST</option>
                                                <option value="PUT">PUT</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="chaining-rule-field">
                                        <label className="settings-field-label">URL</label>
                                        <input
                                            className="input settings-field-input"
                                            value={step.url || ''}
                                            onChange={(e) => handleUpdateStep(i, { url: e.target.value })}
                                            placeholder="https://api.example.com/login"
                                        />
                                    </div>
                                    <div className="chaining-rule-field">
                                        <label className="settings-field-label">Body (JSON)</label>
                                        <textarea
                                            className="input settings-field-input"
                                            value={step.body || ''}
                                            onChange={(e) => handleUpdateStep(i, { body: e.target.value })}
                                            placeholder='{"username": "admin", "password": "password"}'
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
                <button className="btn chaining-rule-add-btn" onClick={handleAddStep}>
                    + Add Step
                </button>
            </div>
        </div>
    );
}
