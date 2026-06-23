import { useEffect, useCallback, useState } from 'react';
import type { FuzzResult } from './types.js';
import type { HeatmapFilter } from './components/Dashboard/Heatmap.js';
import { useConfig, validateConfig } from './hooks/useConfig.js';
import { useRunner } from './hooks/useRunner.js';
import type { ResultSummary } from './hooks/useRunner.js';
import { useDb } from './hooks/useDb.js';
import { Header } from './components/Header.js';
import { Sidebar } from './components/Sidebar/Sidebar.js';
import { RequestDetail } from './components/Inspector/RequestDetail.js';
import { ConfigSidebar } from './components/Sidebar/ConfigSidebar.js';
import { Toast } from './components/Toast/Toast.js';
import { useToast } from './hooks/useToast.js';
import { useResizableLayout } from './hooks/useResizableLayout.js';
import { useFuzzSession } from './hooks/useFuzzSession.js';
import { useRunHistory } from './hooks/useRunHistory.js';
import { useTheme } from './hooks/useTheme.js';
import { MainWorkspace } from './components/MainWorkspace.js';
import { useAppStore } from './store/appStore.js';
import { useShallow } from 'zustand/react/shallow';
import { HotkeysHelpModal } from './components/Shared/HotkeysHelpModal.js';
import { useAuth } from './hooks/useAuth.js';
import { LoginScreen } from './components/Auth/LoginScreen.js';

const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

export default function App() {
    const { authEnabled, token, isGuest, isLoading, login, register, continueAsGuest, logout } = useAuth();
    const { theme, toggleTheme } = useTheme();
    const { toasts, showToast, dismissToast } = useToast();

    useEffect(() => {
        if (token) {
            fetch(`${PROXY_URL}/api/auth/me`, {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(res => {
                if (res.ok) return res.json();
                throw new Error('Failed to fetch profile');
            })
            .then(data => {
                useAppStore.setState({ userProfile: { username: data.username, apiKey: data.api_key, publicKey: data.public_key } });
            })
            .catch(err => {
                console.error(err);
                useAppStore.setState({ userProfile: null });
            });
        } else {
            useAppStore.setState({ userProfile: null, activeProject: null });
        }
    }, [token]);

    // Only subscribe to what App.tsx needs for rendering
    const {
        activeTab,
        selectedResult,
        isSidebarOpen,
        isConfigOpen,
        isSidebarHiddenDesktop,
        isConfigHiddenDesktop,
        isHotkeysHelpOpen
    } = useAppStore(useShallow(state => ({
        activeTab: state.activeTab,
        selectedResult: state.selectedResult,
        isSidebarOpen: state.isSidebarOpen,
        isConfigOpen: state.isConfigOpen,
        isSidebarHiddenDesktop: state.isSidebarHiddenDesktop,
        isConfigHiddenDesktop: state.isConfigHiddenDesktop,
        isHotkeysHelpOpen: state.isHotkeysHelpOpen,
    })));

    const {
        config, updateConfig, updateHeaders, updateCookies,
        updateDictionaries, updateProfiles, importConfig, exportConfig
    } = useConfig();

    const [triagePrompt, setTriagePrompt] = useState<{
        id: string;
        triage: 'false_positive' | 'ignored' | 'acknowledged' | 'none';
        ruleId: string;
        endpoint: string;
        method: string;
        payload?: string;
    } | null>(null);
    const [triageScope, setTriageScope] = useState<'finding' | 'endpoint' | 'all'>('finding');

    const { start, stop, pause, resume, sendRequest } = useRunner(PROXY_URL);

    const { db, runs, getDb, saveRun, importCliReport, queryResults, getRunResults, deleteRun, updateTriage, getAllTriaged } = useDb();

    const { handleLoadRun, handleDeleteRun, handleExport, handleExportHTML, handleExportMD } = useRunHistory({
        runs,
        queryResults,
        getRunResults,
        deleteRun,
        showToast,
        onRunLoaded: () => {
            useAppStore.setState({
                selectedResult: null,
                heatmapFilter: null,
            });
        },
    });

    const { loadEndpoints, handleStart } = useFuzzSession({
        config: config as any,
        updateConfig,
        start,
        saveRun,
        getDb,
        showToast,
    });

    const handleImportConfig = useCallback((jsonString: string) => {
        let parsed: any;
        try {
            parsed = JSON.parse(jsonString);
        } catch (err) {
            throw new Error('Invalid JSON: ' + (err instanceof Error ? err.message : String(err)));
        }

        // Normalize CLI inputs
        if (parsed.headers && !parsed.global_headers) {
            parsed.global_headers = parsed.headers;
        }
        if (parsed.swagger_urls && !parsed._swagger_urls) {
            parsed._swagger_urls = parsed.swagger_urls;
        }
        if (parsed.endpoints && typeof parsed.endpoints === 'object' && !Array.isArray(parsed.endpoints)) {
            if (parsed.endpoints.exclude && !parsed.disabled_endpoints) {
                parsed.disabled_endpoints = parsed.endpoints.exclude;
            }
            parsed.endpoints = [];
        }

        // Run the validation
        validateConfig(parsed);

        // Call importConfig
        importConfig(JSON.stringify(parsed));

        // After updating the state, if the imported config contains _swagger_urls but the endpoints list is empty,
        // asynchronously call loadEndpoints(_swagger_urls) after a short delay (e.g. setTimeout) to automatically fetch and populate spec endpoints in the UI.
        if (parsed._swagger_urls && parsed._swagger_urls.length > 0 && (!parsed.endpoints || parsed.endpoints.length === 0)) {
            setTimeout(() => {
                loadEndpoints(parsed._swagger_urls).catch(err => {
                    showToast('Failed to automatically load endpoints: ' + (err instanceof Error ? err.message : String(err)), 'error');
                });
            }, 100);
        }
    }, [importConfig, loadEndpoints, showToast]);

    const handleConfirmTriageIgnore = useCallback(() => {
        if (!triagePrompt) return;

        const newRule: any = {
            rule_id: triagePrompt.ruleId,
        };

        if (triageScope === 'finding') {
            newRule.endpoint = triagePrompt.endpoint;
            newRule.method = triagePrompt.method;
        } else if (triageScope === 'endpoint') {
            newRule.endpoint = triagePrompt.endpoint;
        } else if (triageScope === 'all') {
            newRule.endpoint = '**';
        }

        // Clean payload if present and short enough
        if (triagePrompt.payload && triagePrompt.payload.length > 0 && triagePrompt.payload.length < 150) {
            let cleanPayload = triagePrompt.payload.trim();
            if (cleanPayload.includes('…')) {
                cleanPayload = cleanPayload.split('…')[0].trim();
            }
            if (!cleanPayload.startsWith('{') && !cleanPayload.startsWith('[')) {
                if (cleanPayload.startsWith('"') && cleanPayload.endsWith('"')) {
                    try {
                        const parsed = JSON.parse(cleanPayload);
                        if (typeof parsed === 'string') {
                            cleanPayload = parsed;
                        }
                    } catch { /* */ }
                }
                if (typeof cleanPayload === 'string' && cleanPayload.trim().length > 0) {
                    newRule.payload = cleanPayload;
                }
            }
        }

        const currentIgnoreRules = config.rules?.ignore_rules || [];
        // Check if identical rule already exists to avoid duplication
        const exists = currentIgnoreRules.some(r => 
            r.rule_id === newRule.rule_id && 
            r.endpoint === newRule.endpoint && 
            r.method === newRule.method && 
            r.payload === newRule.payload
        );

        if (!exists) {
            updateConfig({
                rules: {
                    ...config.rules,
                    ignore_rules: [...currentIgnoreRules, newRule],
                }
            });
            showToast(`Added ignore rule for ${newRule.rule_id}`, 'success');
        } else {
            showToast(`Ignore rule already exists in config`, 'info');
        }

        setTriagePrompt(null);
    }, [triagePrompt, triageScope, config, updateConfig, showToast]);

    const handleTriage = useCallback(async (id: string, triage: 'false_positive' | 'ignored' | 'acknowledged' | 'none') => {
        await updateTriage(id, triage);
        const current = useAppStore.getState().selectedResult;
        const matchesCurrent = current && current.id === id;
        if (matchesCurrent) {
            useAppStore.setState({
                selectedResult: { ...current, triage } as any
            });
        }
        // Force refresh of the results list in Inspector
        useAppStore.setState(state => ({ liveCount: state.liveCount + 1 }));

        if (triage === 'ignored' || triage === 'false_positive') {
            if (current && current.id === id) {
                const ruleId = current.analyzerFindings?.[0]?.ruleId || (current.status && current.status > 0 ? `swazz/status-${current.status}` : 'swazz/network-error');
                setTriagePrompt({
                    id,
                    triage,
                    ruleId,
                    endpoint: current.endpoint || '',
                    method: current.method || '',
                    payload: typeof current.payload === 'string' ? current.payload : (current.payload ? JSON.stringify(current.payload) : ''),
                });
                setTriageScope('finding');
            } else {
                showToast(`Result triaged as: ${triage}`, 'info');
            }
        } else {
            if (triage === 'none' || triage === 'acknowledged') {
                if (current && current.id === id) {
                    const ruleId = current.analyzerFindings?.[0]?.ruleId || (current.status && current.status > 0 ? `swazz/status-${current.status}` : 'swazz/network-error');
                    const currentIgnoreRules = config.rules?.ignore_rules || [];
                    const filteredRules = currentIgnoreRules.filter(r => 
                        !(r.rule_id === ruleId && r.endpoint === current.endpoint && r.method === current.method)
                    );
                    if (filteredRules.length !== currentIgnoreRules.length) {
                        updateConfig({
                            rules: {
                                ...config.rules,
                                ignore_rules: filteredRules,
                            }
                        });
                        showToast(`Removed matching ignore rule for ${ruleId}`, 'info');
                    } else {
                        showToast(`Result triaged as: ${triage === 'none' ? 'No Triage' : triage}`, 'info');
                    }
                } else {
                    showToast(`Result triaged as: ${triage === 'none' ? 'No Triage' : triage}`, 'info');
                }
            } else {
                showToast(`Result triaged as: ${triage === 'none' ? 'No Triage' : triage}`, 'info');
            }
        }
    }, [updateTriage, showToast, config, updateConfig]);

    const handleExportIgnoreRules = useCallback(async () => {
        const triaged = await getAllTriaged();
        if (triaged.length === 0) {
            showToast('No triaged findings to export.', 'info');
            return;
        }

        const ignoreRules = triaged.map(f => {
            const ruleId = f.analyzerFindings?.[0]?.ruleId || (f.status > 0 ? `swazz/status-${f.status}` : 'swazz/network-error');
            const rule: any = {
                rule_id: ruleId,
                endpoint: f.endpoint,
                method: f.method,
            };
            if (f.payloadPreview && f.payloadPreview.length > 0 && f.payloadPreview.length < 150) {
                let cleanPayload = f.payloadPreview.trim();
                if (cleanPayload.includes('…')) {
                    cleanPayload = cleanPayload.split('…')[0].trim();
                }
                if (!cleanPayload.startsWith('{') && !cleanPayload.startsWith('[')) {
                    if (cleanPayload.startsWith('"') && cleanPayload.endsWith('"')) {
                        try {
                            const parsed = JSON.parse(cleanPayload);
                            if (typeof parsed === 'string') {
                                cleanPayload = parsed;
                            }
                        } catch { /* */ }
                    }
                    if (typeof cleanPayload === 'string' && cleanPayload.trim().length > 0) {
                        rule.payload = cleanPayload;
                    }
                }
            }
            return rule;
        });

        const blob = new Blob([JSON.stringify(ignoreRules, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'swazz.ignore.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`Exported ${ignoreRules.length} ignore rules.`, 'success');
    }, [getAllTriaged, showToast]);

    const displayUrl = config.base_url || (config._swagger_urls?.[0] ?? '');

    const { sidebarWidth, configSidebarWidth, startResizingLeft, startResizingRight } = useResizableLayout(300, 320);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const activeTag = document.activeElement?.tagName.toLowerCase();
            const isInputActive = activeTag === 'input' || activeTag === 'textarea' || document.activeElement?.hasAttribute('contenteditable');

            const mod = e.metaKey || e.ctrlKey;
            const shift = e.shiftKey;
            const alt = e.altKey;

            if (isInputActive && e.key !== 'Escape' && !mod) {
                return;
            }

            const state = useAppStore.getState();

            // Global Escape key
            if (e.key === 'Escape') {
                if (isInputActive) {
                    (document.activeElement as HTMLElement)?.blur();
                    return;
                }
                if (state.isHotkeysHelpOpen) {
                    useAppStore.setState({ isHotkeysHelpOpen: false });
                } else if (state.selectedResult) {
                    useAppStore.setState({ selectedResult: null });
                } else if (state.activeTab === 'logs') {
                    useAppStore.setState({ activeTab: 'heatmap' });
                } else {
                    useAppStore.setState({
                        isSidebarOpen: false,
                        isConfigOpen: false,
                        isSidebarHiddenDesktop: true,
                        isConfigHiddenDesktop: true,
                    });
                }
                return;
            }

            // Shift + ? / ? key
            if (e.key === '?' || (e.key === '/' && shift)) {
                e.preventDefault();
                useAppStore.setState(s => ({ isHotkeysHelpOpen: !s.isHotkeysHelpOpen }));
                return;
            }

            // Tab keys 1, 2, 3, 4 (only when no modifiers are pressed to avoid breaking browser tab switching)
            if (!mod && !alt && !shift) {
                if (e.key === '1') {
                    e.preventDefault();
                    useAppStore.setState({ activeTab: 'heatmap' });
                    return;
                }
                if (e.key === '2') {
                    e.preventDefault();
                    useAppStore.setState({ activeTab: 'logs' });
                    return;
                }
                if (e.key === '3') {
                    e.preventDefault();
                    useAppStore.setState({ activeTab: 'findings' });
                    return;
                }
                if (e.key === '4') {
                    e.preventDefault();
                    useAppStore.setState({ activeTab: 'owasp' });
                    return;
                }
                if (e.key === '5') {
                    e.preventDefault();
                    useAppStore.setState({ activeTab: 'history' });
                    return;
                }
            }

            // Run: Mod + Enter
            if (mod && e.key === 'Enter') {
                e.preventDefault();
                handleStart();
                return;
            }

            // Pause / Resume: Mod + Shift + P
            if (mod && shift && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                const running = state.isRunning;
                const paused = state.isPaused;
                if (running) {
                    if (paused) {
                        resume().catch((err: any) => showToast(err.message || 'Failed to resume', 'error'));
                    } else {
                        pause().catch((err: any) => showToast(err.message || 'Failed to pause', 'error'));
                    }
                }
                return;
            }

            // Stop: Mod + Shift + X
            if (mod && shift && e.key.toLowerCase() === 'x') {
                e.preventDefault();
                stop().catch((err: any) => showToast(err.message || 'Failed to stop', 'error'));
                return;
            }

            // Sidebar toggles: Alt + L, Alt + C
            if (alt && e.code === 'KeyL') {
                e.preventDefault();
                if (window.innerWidth <= 768) {
                    useAppStore.setState(s => ({ isSidebarOpen: !s.isSidebarOpen }));
                } else {
                    useAppStore.setState(s => ({ isSidebarHiddenDesktop: !s.isSidebarHiddenDesktop }));
                }
                return;
            }
            if (alt && e.code === 'KeyC') {
                e.preventDefault();
                if (window.innerWidth <= 768) {
                    useAppStore.setState(s => ({ isConfigOpen: !s.isConfigOpen }));
                } else {
                    useAppStore.setState(s => ({ isConfigHiddenDesktop: !s.isConfigHiddenDesktop }));
                }
                return;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleStart, stop, pause, resume, showToast]);

    const handleSelectResult = (row: ResultSummary) => {
        useAppStore.setState({ selectedResult: {
            ...row,
            payload: row.payloadPreview || undefined,
            responseBody: row.responsePreview || undefined,
        } as FuzzResult });
    };

    if (isLoading) {
        return <div className="app-layout" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
    }

    if (authEnabled && !token && !isGuest) {
        return <LoginScreen onLogin={login} onRegister={register} onGuest={continueAsGuest} />;
    }

    return (
        <div className="app-layout" style={{ gridTemplateColumns: `${isSidebarHiddenDesktop ? 0 : sidebarWidth}px 1fr` }}>
            <Header
                baseUrl={displayUrl}
                onChangeBaseUrl={(url) => {
                    const trimmed = url.trim();
                    if (trimmed.endsWith('swagger.json')) {
                        try {
                            const inputUrl = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
                            const parsed = new URL(inputUrl);
                            const origin = parsed.origin;
                            const currentUrls = config._swagger_urls || [];
                            if (!currentUrls.includes(inputUrl)) {
                                const newUrls = [...currentUrls, inputUrl];
                                updateConfig({ base_url: origin, _swagger_urls: newUrls });
                                loadEndpoints(newUrls);
                            } else {
                                updateConfig({ base_url: origin });
                            }
                        } catch {
                            updateConfig({ base_url: trimmed });
                        }
                    } else {
                        updateConfig({ base_url: trimmed });
                    }
                }}
                onStart={(cleanUrl) => handleStart(undefined, cleanUrl)}
                onStop={() => stop().catch((err: any) => showToast(err.message || 'Failed to stop', 'error'))}
                onPause={() => pause().catch((err: any) => showToast(err.message || 'Failed to pause', 'error'))}
                onResume={() => resume().catch((err: any) => showToast(err.message || 'Failed to resume', 'error'))}
                onToggleSidebar={() => {
                    if (window.innerWidth <= 768) useAppStore.setState({ isSidebarOpen: !isSidebarOpen });
                    else useAppStore.setState({ isSidebarHiddenDesktop: !isSidebarHiddenDesktop });
                }}
                onToggleConfig={() => {
                    if (window.innerWidth <= 768) useAppStore.setState({ isConfigOpen: !isConfigOpen });
                    else useAppStore.setState({ isConfigHiddenDesktop: !isConfigHiddenDesktop });
                }}
                theme={theme}
                onToggleTheme={toggleTheme}
                authEnabled={authEnabled}
                token={token}
                isGuest={isGuest}
                onLogout={logout}
            />

            <Sidebar
                className={`${isSidebarOpen ? 'mobile-open' : ''} ${isSidebarHiddenDesktop ? 'hidden-desktop' : ''}`}
                config={config}
                runs={runs}
                onLoadRun={(id, importedRun) => {
                    handleLoadRun(id, importedRun);
                    useAppStore.setState({ isSidebarOpen: false });
                }}
                onDeleteRun={handleDeleteRun}
                onUpdateConfig={updateConfig}
                onToast={showToast}
                onLoadEndpoints={loadEndpoints}
                onImportRun={importCliReport}
                authEnabled={authEnabled}
                token={token}
            />

            {(isSidebarOpen || isConfigOpen) && (
                <div className="mobile-overlay" onClick={() => {
                    useAppStore.setState({
                        isSidebarOpen: false,
                        isConfigOpen: false,
                    });
                }} />
            )}

            <main className="main-content" style={{ gridArea: 'main', minWidth: 0, height: '100%', overflow: 'hidden', display: 'grid', gridTemplateColumns: `minmax(0, 1fr) ${isConfigHiddenDesktop ? 0 : configSidebarWidth}px` }}>
                <MainWorkspace
                    config={config}
                    handleStart={handleStart}
                    handleSelectResult={handleSelectResult}
                    handleExport={handleExport}
                    handleExportHTML={handleExportHTML}
                    handleExportMD={handleExportMD}
                    handleLoadRun={handleLoadRun}
                    handleDeleteRun={handleDeleteRun}
                    queryResults={queryResults}
                    runs={runs}
                    onImportRun={importCliReport}
                />

                <ConfigSidebar
                    className={`${isConfigOpen ? 'mobile-open' : ''} ${isConfigHiddenDesktop ? 'hidden-desktop' : ''}`}
                    config={config}
                    onUpdateHeaders={updateHeaders}
                    onUpdateCookies={updateCookies}
                    onUpdateDictionaries={updateDictionaries}
                    onUpdateProfiles={updateProfiles}
                    onUpdateConfig={updateConfig}
                    onImportConfig={handleImportConfig}
                    onExportConfig={exportConfig}
                    onExportIgnoreRules={handleExportIgnoreRules}
                    onToast={showToast}
                />
            </main>

            {selectedResult && (
                <RequestDetail
                    result={selectedResult}
                    baseUrl={displayUrl}
                    onClose={() => useAppStore.setState({ selectedResult: null })}
                    onReplay={sendRequest}
                    globalHeaders={config.global_headers}
                    globalCookies={config.cookies}
                    config={config}
                    onTriage={handleTriage}
                />
            )}

            {triagePrompt && (
                <div className="modal-container">
                    <div className="modal-overlay" onClick={() => setTriagePrompt(null)} />
                    <div className="ignore-modal-content">
                        <div className="modal-header">
                            <h2>Add Ignore Rule</h2>
                            <button className="modal-close" onClick={() => setTriagePrompt(null)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="ignore-modal-form">
                                <div className="ignore-modal-field">
                                    <label className="ignore-modal-label">Rule ID</label>
                                    <input className="input" type="text" value={triagePrompt.ruleId} readOnly />
                                </div>
                                <div className="ignore-modal-field">
                                    <label className="ignore-modal-label">Select Scope</label>
                                    <div className="ignore-modal-radio-group">
                                        <label className="ignore-modal-radio-label">
                                            <input 
                                                type="radio" 
                                                name="ignore-scope" 
                                                value="finding" 
                                                checked={triageScope === 'finding'} 
                                                onChange={() => setTriageScope('finding')} 
                                            />
                                            <div>
                                                <div>Only this finding</div>
                                                <div className="ignore-modal-radio-desc">
                                                    Mute rule <strong>{triagePrompt.ruleId}</strong> on <strong>{triagePrompt.method} {triagePrompt.endpoint}</strong>
                                                </div>
                                            </div>
                                        </label>
                                        <label className="ignore-modal-radio-label">
                                            <input 
                                                type="radio" 
                                                name="ignore-scope" 
                                                value="endpoint" 
                                                checked={triageScope === 'endpoint'} 
                                                onChange={() => setTriageScope('endpoint')} 
                                            />
                                            <div>
                                                <div>All methods on this endpoint</div>
                                                <div className="ignore-modal-radio-desc">
                                                    Mute rule <strong>{triagePrompt.ruleId}</strong> on <strong>{triagePrompt.endpoint}</strong> for any method
                                                </div>
                                            </div>
                                        </label>
                                        <label className="ignore-modal-radio-label">
                                            <input 
                                                type="radio" 
                                                name="ignore-scope" 
                                                value="all" 
                                                checked={triageScope === 'all'} 
                                                onChange={() => setTriageScope('all')} 
                                            />
                                            <div>
                                                <div>Everywhere</div>
                                                <div className="ignore-modal-radio-desc">
                                                    Mute rule <strong>{triagePrompt.ruleId}</strong> across all endpoints
                                                </div>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                                <div className="ignore-modal-footer">
                                    <button className="btn btn-ghost" onClick={() => setTriagePrompt(null)}>Cancel</button>
                                    <button className="btn btn-primary" onClick={handleConfirmTriageIgnore}>Ignore Finding</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isHotkeysHelpOpen && (
                <HotkeysHelpModal
                    onClose={() => useAppStore.setState({ isHotkeysHelpOpen: false })}
                />
            )}


            <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200 }}>
                {toasts.map((t) => (
                    <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => dismissToast(t.id)} />
                ))}
            </div>

            {!isSidebarHiddenDesktop && <div className="sidebar-resizer" style={{ left: sidebarWidth - 4 }} onMouseDown={startResizingLeft} title="Drag to resize" />}
            {!isConfigHiddenDesktop && <div className="sidebar-resizer" style={{ right: configSidebarWidth - 4, left: 'auto' }} onMouseDown={startResizingRight} title="Drag to resize" />}
        </div>
    );
}
