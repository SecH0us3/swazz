// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState, useEffect, useRef } from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { useAppStore } from '../../store/appStore.js';
import type { WAFDetection, WAFPatchReport } from '../../types.js';
import { WafPatchViewer } from '../Inspector/WafPatchViewer.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export interface WafCheckResponse {
    detection: WAFDetection;
    recommendation?: string;
    sensitiveFiles?: {
        total: number;
        results: Array<{
            category: string;
            method: string;
            status: number;
            payload: string;
            responseTime?: number;
            durationMs?: number;
            statusText?: string;
            path?: string;
            [key: string]: any;
        }>;
    };
    patches?: WAFPatchReport;
}

export interface WafCheckPanelProps {
    targetUrl?: string;
}

function isUnprotectedStatus(status: number): boolean {
    return status === 200 || status === 404 || status >= 500;
}

export function WafCheckPanel({ targetUrl }: WafCheckPanelProps) {
    const { config } = useConfig();
    const defaultUrl = (targetUrl !== undefined ? targetUrl : config?.base_url) || '';
    const [inputUrl, setInputUrl] = useState(defaultUrl);
    const lastDefaultRef = useRef(defaultUrl);

    useEffect(() => {
        if (lastDefaultRef.current !== defaultUrl) {
            if (inputUrl === lastDefaultRef.current || !inputUrl.trim()) {
                setInputUrl(defaultUrl);
            }
            lastDefaultRef.current = defaultUrl;
        }
    }, [defaultUrl, inputUrl]);

    const trimmedUrl = inputUrl.trim();
    const hasUrl = Boolean(trimmedUrl);

    const [isLoading, setIsLoading] = useState(false);
    const [loadingStep, setLoadingStep] = useState<'detecting' | 'scanning'>('detecting');
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<WafCheckResponse | null>(null);
    const [showEvidence, setShowEvidence] = useState(false);
    const [showAllFiles, setShowAllFiles] = useState(false);
    const [isFilesTableExpanded, setIsFilesTableExpanded] = useState(false);

    const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (stepTimerRef.current) {
                clearTimeout(stepTimerRef.current);
            }
        };
    }, []);

    const handleRunWafCheck = async () => {
        if (!hasUrl || isLoading) return;
        setIsLoading(true);
        setLoadingStep('detecting');
        setError(null);
        setResult(null);
        setShowEvidence(false);
        setShowAllFiles(false);

        if (stepTimerRef.current) {
            clearTimeout(stepTimerRef.current);
        }
        stepTimerRef.current = setTimeout(() => {
            setLoadingStep('scanning');
        }, 3500);

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const csrfToken = useAppStore.getState().csrfToken;
            if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

            const res = await fetch(`${PROXY_URL}/api/waf-check`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ url: trimmedUrl }),
            });

            let data: any;
            try {
                data = await res.json();
            } catch {
                data = null;
            }

            if (!res.ok) {
                throw new Error(data?.error || `WAF check failed with status ${res.status}`);
            }

            setResult(data);
        } catch (err: any) {
            setError(err.message || 'Failed to run WAF check');
        } finally {
            if (stepTimerRef.current) {
                clearTimeout(stepTimerRef.current);
                stepTimerRef.current = null;
            }
            setIsLoading(false);
        }
    };

    const sensitiveResults = result?.sensitiveFiles?.results || [];
    const totalFilesChecked = sensitiveResults.length;
    const unprotectedFiles = sensitiveResults.filter(r => isUnprotectedStatus(r.status));
    const unprotectedCount = unprotectedFiles.length;
    const blockedCount = totalFilesChecked - unprotectedCount;
    const displayedFiles = showAllFiles ? sensitiveResults : unprotectedFiles;

    const rawConfidence = result?.detection?.confidence ?? 0;
    const normalizedConfidence = (rawConfidence <= 1 && rawConfidence > 0)
        ? rawConfidence * 100
        : rawConfidence;
    const confidenceScore = Math.round(Math.min(100, normalizedConfidence));

    return (
        <div className="waf-panel" data-testid="waf-check-panel">
            <div className="waf-panel-toolbar">
                <div className="waf-panel-toolbar-left">
                    <input
                        type="text"
                        className="input waf-target-input"
                        data-testid="waf-target-input"
                        placeholder="https://example.com"
                        value={inputUrl}
                        onChange={(e) => setInputUrl(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && hasUrl && !isLoading) {
                                handleRunWafCheck();
                            }
                        }}
                        disabled={isLoading}
                        aria-label="WAF check target URL"
                    />
                    <button
                        type="button"
                        className="btn btn-sm btn-primary waf-run-btn"
                        disabled={isLoading || !hasUrl}
                        onClick={handleRunWafCheck}
                        data-testid="run-waf-check-btn"
                    >
                        {isLoading ? 'Checking WAF...' : '▶ Run WAF Check'}
                    </button>
                </div>
                <div className="waf-panel-toolbar-right">
                    {isLoading && (
                        <span className="waf-loading-text" data-testid="waf-check-loading">
                            <span className="waf-spinner" aria-hidden="true" />
                            {loadingStep === 'detecting'
                                ? 'Detecting WAF vendor...'
                                : 'Scanning for exposed files (up to a minute)...'}
                        </span>
                    )}
                    <a
                        className="waf-check-attribution"
                        href="https://waf.secmy.app/"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Powered by waf.secmy.app ↗
                    </a>
                </div>
            </div>

            {error && (
                <div className="waf-detection-card is-error" data-testid="waf-check-error">
                    <div className="waf-detection-icon" aria-hidden="true">⚠️</div>
                    <div className="waf-detection-body">
                        <div className="waf-detection-title">Check Failed</div>
                        <div className="waf-detection-sub">{error}</div>
                    </div>
                </div>
            )}

            {result && !result.detection?.detected && (
                <div className="waf-detection-card is-warning" data-testid="waf-check-recommendation">
                    <div className="waf-detection-icon" aria-hidden="true">⚠️</div>
                    <div className="waf-detection-body">
                        <div className="waf-detection-title">No WAF Detected</div>
                        <p className="waf-recommendation-body">
                            {result.recommendation || 'This target has no Web Application Firewall protecting it. Consider enabling one to add a defensive layer against common attacks.'}
                        </p>
                        <div className="waf-vendor-chips">
                            <span className="waf-vendor-chip">Cloudflare</span>
                            <span className="waf-vendor-chip">AWS WAF</span>
                            <span className="waf-vendor-chip">ModSecurity</span>
                        </div>
                    </div>
                </div>
            )}

            {result && result.detection?.detected && (
                <>
                    <div className="waf-detection-card is-success waf-detection-card-inline" data-testid="waf-check-detected">
                        <div
                            className="waf-confidence-ring"
                            data-testid="waf-confidence-ring"
                            style={{ '--pct': confidenceScore } as React.CSSProperties}
                        >
                            <div className="waf-confidence-ring-inner">{confidenceScore}%</div>
                        </div>
                        <div className="waf-detection-title">
                            Protected by <span className="waf-vendor-name">{result.detection.wafType}</span>
                            {' / '}
                            {result.detection.evidence && result.detection.evidence.length > 0
                                ? `${result.detection.evidence.length} signature match${result.detection.evidence.length === 1 ? '' : 'es'}`
                                : 'Header + status-code signature match'}
                        </div>
                        {result.detection.evidence && result.detection.evidence.length > 0 && (
                            <button
                                type="button"
                                className="waf-evidence-toggle"
                                data-testid="waf-evidence-toggle-btn"
                                onClick={() => setShowEvidence(!showEvidence)}
                            >
                                {showEvidence ? '▾ Hide evidence' : '▸ Show evidence'} ({result.detection.evidence.length})
                            </button>
                        )}
                    </div>
                    {showEvidence && result.detection.evidence && result.detection.evidence.length > 0 && (
                        <ul className="waf-evidence-list" data-testid="waf-evidence-list">
                            {result.detection.evidence.map((ev, i) => (
                                <li key={i}>{ev}</li>
                            ))}
                        </ul>
                    )}
                </>
            )}

            {totalFilesChecked > 0 && (
                <div className="waf-stats-row" data-testid="waf-stats-row">
                    <div className="waf-stat-pill">
                        <span className="waf-stat-pill-value">{totalFilesChecked}</span>
                        <span className="waf-stat-pill-label">Paths Checked</span>
                    </div>
                    <div className="waf-stat-pill stat-danger">
                        <span className="waf-stat-pill-value">{unprotectedCount}</span>
                        <span className="waf-stat-pill-label">Unprotected</span>
                    </div>
                    <div className="waf-stat-pill stat-ok">
                        <span className="waf-stat-pill-value">{blockedCount}</span>
                        <span className="waf-stat-pill-label">Blocked / Redirected</span>
                    </div>
                </div>
            )}

            {totalFilesChecked > 0 && (
                <div className="waf-table-card" data-testid="waf-sensitive-files-table">
                    <button
                        type="button"
                        className="waf-table-card-header waf-table-card-header-toggle"
                        data-testid="waf-files-section-toggle"
                        onClick={() => setIsFilesTableExpanded(!isFilesTableExpanded)}
                        aria-expanded={isFilesTableExpanded}
                    >
                        <span className="waf-table-card-title">
                            <span className="waf-table-card-chevron">{isFilesTableExpanded ? '▾' : '▸'}</span>
                            {showAllFiles ? `Sensitive Files Probed (${totalFilesChecked})` : 'Sensitive Files — Unprotected'}
                        </span>
                        <span className={`badge ${unprotectedCount > 0 ? 'badge-error' : 'badge-success'}`}>
                            {unprotectedCount} exposed
                        </span>
                    </button>
                    {isFilesTableExpanded && (
                        <>
                            <div className="waf-table-scroll">
                                <table className="waf-table">
                                    <thead>
                                        <tr>
                                            <th>Status</th>
                                            <th>Path</th>
                                            <th>Method</th>
                                            <th>Response</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {displayedFiles.map((row, idx) => (
                                            <tr key={idx}>
                                                <td>
                                                    <span className={`badge ${row.status === 200 ? 'badge-error' : (row.status === 404 || row.status >= 500 ? 'badge-warning' : 'badge-success')}`}>
                                                        {row.status}
                                                    </span>
                                                </td>
                                                <td className="payload-cell">{row.payload || row.path || ''}</td>
                                                <td>{row.method || 'GET'}</td>
                                                <td>
                                                    {row.durationMs != null
                                                        ? `${row.durationMs}ms`
                                                        : row.responseTime != null
                                                            ? `${row.responseTime}ms`
                                                            : row.statusText || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {totalFilesChecked > unprotectedCount && (
                                <div className="waf-table-footer">
                                    <button
                                        type="button"
                                        data-testid="waf-files-toggle-btn"
                                        onClick={() => setShowAllFiles(!showAllFiles)}
                                    >
                                        {showAllFiles ? 'Show unprotected only' : `Show all ${totalFilesChecked} checked paths →`}
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {result?.patches && (
                <WafPatchViewer report={result.patches} />
            )}

            {!result && !isLoading && !error && (
                <div className="waf-detection-card">
                    <div className="waf-detection-icon" aria-hidden="true">🛡️</div>
                    <div className="waf-detection-body">
                        <div className="waf-detection-title">On-Demand WAF Check</div>
                        <div className="waf-detection-sub">
                            {hasUrl
                                ? `Probe ${trimmedUrl} for active Web Application Firewalls, exposed sensitive files, and virtual patch rules.`
                                : 'Enter a target URL above to probe for WAF protection and virtual patches.'}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
