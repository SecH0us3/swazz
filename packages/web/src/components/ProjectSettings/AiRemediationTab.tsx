import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';

export function AiRemediationTab() {
    const activeProject = useAppStore(state => state.activeProject);
    const projects = useAppStore(state => state.projects);

    const [urlMappings, setUrlMappings] = useState(activeProject?.url_mappings || '');
    const [aiPrompts, setAiPrompts] = useState(activeProject?.ai_prompts || '');
    const [customCliCommand, setCustomCliCommand] = useState(activeProject?.custom_cli_command || '');
    const [autoFixRules, setAutoFixRules] = useState(activeProject?.auto_fix_rules || '');
    const [proposeFixes, setProposeFixes] = useState(activeProject?.propose_fixes === 1);

    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState('');

    useEffect(() => {
        if (activeProject) {
            setUrlMappings(activeProject.url_mappings || '');
            setAiPrompts(activeProject.ai_prompts || '');
            setCustomCliCommand(activeProject.custom_cli_command || '');
            setAutoFixRules(activeProject.auto_fix_rules || '');
            setProposeFixes(activeProject.propose_fixes === 1);
        }
    }, [activeProject]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeProject) return;

        setIsSaving(true);
        setSaveSuccess(false);
        setSaveError('');

        const token = localStorage.getItem('swazz_token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        try {
            const res = await fetch(`/api/projects/${activeProject.id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    url_mappings: urlMappings,
                    ai_prompts: aiPrompts,
                    custom_cli_command: customCliCommand,
                    auto_fix_rules: autoFixRules,
                    propose_fixes: proposeFixes ? 1 : 0
                })
            });

            if (!res.ok) {
                let errMsg = 'Failed to update AI remediation settings';
                try {
                    const errData = await res.json();
                    errMsg = errData.error || errMsg;
                } catch {}
                throw new Error(errMsg);
            }

            const updatedProject = { 
                ...activeProject, 
                url_mappings: urlMappings,
                ai_prompts: aiPrompts,
                custom_cli_command: customCliCommand,
                auto_fix_rules: autoFixRules,
                propose_fixes: proposeFixes ? 1 : 0
            };
            const updatedProjectsList = projects.map(p => p.id === activeProject.id ? updatedProject : p);
            
            useAppStore.setState({
                activeProject: updatedProject,
                projects: updatedProjectsList
            });

            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            setSaveError(err.message || 'Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="card settings-card">
            <h2 className="settings-header">
                AI Remediation Config
            </h2>

            <form onSubmit={handleSave} className="settings-form">
                <div>
                    <label className="settings-label">URL to Repository Mappings</label>
                    <textarea 
                        className="input settings-textarea" 

                        value={urlMappings} 
                        onChange={(e) => setUrlMappings(e.target.value)}
                        placeholder={'{\n  "/api/auth/*": "git@github.com:org/repo-auth.git"\n}'}
                        data-1p-ignore
                    />
                    <span className="settings-help-text">
                        JSON mapping of API paths to Git repositories for the local agent to fetch code context.
                    </span>
                </div>

                <div>
                    <label className="settings-label">AI System Prompts</label>
                    <textarea 
                        className="input settings-textarea" 
                        value={aiPrompts} 
                        onChange={(e) => setAiPrompts(e.target.value)}
                        placeholder="Define custom instructions for the triage and remediation passes."
                        data-1p-ignore
                    />
                    <span className="settings-help-text">
                        Provide JSON containing keys like "pass1_triage" and "pass2_remediation".
                    </span>
                </div>

                <div>
                    <label className="settings-label">Custom CLI Command</label>
                    <input 
                        type="text" 
                        className="input settings-input-full" 
                        placeholder="claude -p {{prompt_file}}"
                        value={customCliCommand} 
                        onChange={(e) => setCustomCliCommand(e.target.value)}
                        style={{ fontFamily: 'monospace' }} 
                        data-1p-ignore
                    />
                    <span className="settings-help-text">
                        {"Command template executed by the Go runner (e.g. `agy -p {{prompt_file}}`). Do not use shell variables."}
                    </span>
                </div>

                <div>
                    <label className="settings-label">Rules to Auto-Fix</label>
                    <textarea 
                        className="input settings-textarea" 
                        value={autoFixRules} 
                        onChange={(e) => setAutoFixRules(e.target.value)}
                        placeholder={'[\n  "swazz/bola-idor",\n  "swazz/network-error",\n  "swazz/null-pointer-exception",\n  "swazz/timeout"\n]'}
                        data-1p-ignore
                    />
                    <span className="settings-help-text">
                        JSON array of rule IDs that should be automatically fixed.
                    </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={proposeFixes}
                            onChange={(e) => setProposeFixes(e.target.checked)}
                        />
                        <strong style={{ fontSize: '13px' }}>Propose Fixes Automatically</strong>
                    </label>
                    <span className="settings-help-text" style={{ marginLeft: '24px', lineHeight: '1.4' }}>
                        If enabled, the Go runner will use `git worktree` to clone the target repository, apply the AI patch, and attempt to open a Pull Request.
                    </span>
                </div>

                <div className="settings-actions">
                    <button type="submit" className="btn btn-primary" disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save AI Settings'}
                    </button>
                    {saveSuccess && (
                        <span style={{ color: 'var(--color-success)', fontSize: '13px' }}>✓ Saved successfully</span>
                    )}
                    {saveError && (
                        <span style={{ color: 'var(--color-error)', fontSize: '13px' }}>Error: {saveError}</span>
                    )}
                </div>
            </form>
        </div>
    );
}
