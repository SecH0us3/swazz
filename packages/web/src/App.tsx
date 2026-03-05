import React, { useState, useMemo, useCallback, useEffect } from 'react';
import type { FuzzResult } from '@swazz/core';
import { useConfig } from './hooks/useConfig.js';
import { useRunner } from './hooks/useRunner.js';
import { Header } from './components/Header.js';
import { Sidebar } from './components/Sidebar/Sidebar.js';
import { Dashboard } from './components/Dashboard/Dashboard.js';
import { Inspector } from './components/Inspector/Inspector.js';
import { RequestDetail } from './components/Inspector/RequestDetail.js';

// In dev, proxy goes to local wrangler via Vite proxy; in prod, use deployed Worker URL
const PROXY_URL = import.meta.env.VITE_PROXY_URL || '';

// ─── Toast Component ────────────────────────────────────

interface ToastData {
    id: number;
    message: string;
    type: 'info' | 'success' | 'error';
}

function Toast({ message, type, onDismiss }: { message: string; type: string; onDismiss: () => void }) {
    const borderColor =
        type === 'error' ? 'var(--color-error)' :
            type === 'success' ? 'var(--color-success)' :
                'var(--color-info)';

    useEffect(() => {
        const timer = setTimeout(onDismiss, 4000);
        return () => clearTimeout(timer);
    }, [onDismiss]);

    return (
        <div className="toast" style={{ borderLeft: `3px solid ${borderColor}` }} onClick={onDismiss}>
            {message}
        </div>
    );
}

// ─── App ────────────────────────────────────────────────

export default function App() {
    const {
        config,
        updateConfig,
        updateHeaders,
        updateCookies,
        updateDictionaries,
        updateProfiles,
        importConfig,
        exportConfig,
    } = useConfig();

    const {
        results,
        stats,
        isRunning,
        isPaused,
        start,
        stop,
        pause,
        resume,
    } = useRunner(PROXY_URL);

    const [selectedResult, setSelectedResult] = useState<FuzzResult | null>(null);
    const [toasts, setToasts] = useState<ToastData[]>([]);

    const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
        const id = Date.now();
        setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const endpointPaths = useMemo(
        () => config.endpoints.map((ep) => ep.path),
        [config.endpoints],
    );

    const handleStart = () => {
        if (!config.base_url) {
            showToast('Please set a target URL first', 'error');
            return;
        }
        if (config.endpoints.length === 0) {
            showToast('Add at least one endpoint to fuzz', 'error');
            return;
        }
        start(config);
        showToast(`Fuzzing ${config.endpoints.length} endpoints...`, 'info');
    };

    return (
        <div className="app-layout">
            <Header
                baseUrl={config.base_url}
                isRunning={isRunning}
                isPaused={isPaused}
                onStart={handleStart}
                onStop={stop}
                onPause={pause}
                onResume={resume}
            />

            <Sidebar
                config={config}
                onUpdateHeaders={updateHeaders}
                onUpdateCookies={updateCookies}
                onUpdateDictionaries={updateDictionaries}
                onUpdateProfiles={updateProfiles}
                onUpdateConfig={updateConfig}
                onImportConfig={importConfig}
                onExportConfig={exportConfig}
                onToast={showToast}
            />

            <div className="main-area">
                <Dashboard stats={stats} results={results} endpointPaths={endpointPaths} />
                <Inspector results={results} onSelectResult={setSelectedResult} />
            </div>

            {selectedResult && (
                <RequestDetail result={selectedResult} onClose={() => setSelectedResult(null)} />
            )}

            {/* Toast stack */}
            <div style={{ position: 'fixed', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 200 }}>
                {toasts.map((t) => (
                    <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => dismissToast(t.id)} />
                ))}
            </div>
        </div>
    );
}
