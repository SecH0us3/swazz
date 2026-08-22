// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { ResultSummary } from '../../hooks/useRunner.js';
import type { QueryOptions } from '../../hooks/useDb.js';
import type { AnalysisFinding } from '../../types.js';
import { getOwaspApiCategories, getCweIds } from '../../hooks/useRunHistory.js';
import './OWASPTop10.css';

export interface OWASPCategoryMeta {
    id: string;
    title: string;
    desc: string;
    link: string;
}

export const OWASP_API_CATEGORIES_METADATA_2023: OWASPCategoryMeta[] = [
    {
        id: 'API1:2023',
        title: 'API1:2023 Broken Object Level Authorization',
        desc: 'Attackers manipulate object identifiers (e.g. IDOR) in API requests to access or modify unauthorized objects belonging to other users.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/',
    },
    {
        id: 'API2:2023',
        title: 'API2:2023 Broken Authentication',
        desc: 'Authentication mechanisms are implemented incorrectly, allowing attackers to compromise tokens, bypass login requirements, or impersonate other users.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/',
    },
    {
        id: 'API3:2023',
        title: 'API3:2023 Broken Object Property Level Authorization',
        desc: 'Endpoints expose excessive data in responses or allow unauthorized mass assignment modification of object properties.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/',
    },
    {
        id: 'API4:2023',
        title: 'API4:2023 Unrestricted Resource Consumption',
        desc: 'Satisfying API requests requires resources such as network bandwidth, CPU, and memory without proper rate limits or size caps, leading to Denial of Service.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/',
    },
    {
        id: 'API5:2023',
        title: 'API5:2023 Broken Function Level Authorization',
        desc: 'Flaws in authorization allow regular users to execute administrative or privileged functions across different hierarchy levels.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xa5-broken-function-level-authorization/',
    },
    {
        id: 'API6:2023',
        title: 'API6:2023 Unrestricted Access to Sensitive Business Flows',
        desc: 'APIs vulnerable to this risk expose business flows (like login, checkout, password resets) without mitigating automated execution abuse.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xa6-unrestricted-access-to-sensitive-business-flows/',
    },
    {
        id: 'API7:2023',
        title: 'API7:2023 Server Side Request Forgery',
        desc: 'The API backend fetches a remote resource without validating the user-supplied URI, allowing attackers to coerce the server into connecting to internal/arbitrary hosts.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xa7-server-side-request-forgery/',
    },
    {
        id: 'API8:2023',
        title: 'API8:2023 Security Misconfiguration',
        desc: 'Insecure default configs, unpatched flaws, permissive CORS headers, or verbose error responses disclosing internal components.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xa8-security-misconfiguration/',
    },
    {
        id: 'API9:2023',
        title: 'API9:2023 Improper Assets Management',
        desc: 'APIs tend to expose more endpoints than traditional web applications (debug, beta, old versions), creating shadow or unmanaged attack surfaces.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xa9-improper-assets-management/',
    },
    {
        id: 'API10:2023',
        title: 'API10:2023 Unsafe Consumption of APIs',
        desc: 'Developers tend to trust data received from third-party or internal APIs more than user inputs, resulting in SQLi, command injection, XXE, or parser crashes.',
        link: 'https://owasp.org/API-Security/editions/2023/en/0xaa-unsafe-consumption-of-apis/',
    },
];

export const OWASP_CATEGORIES_METADATA: OWASPCategoryMeta[] = [
    {
        id: 'A01:2025',
        title: 'A01:2025 Broken Access Control',
        desc: 'Restriction on what authenticated users are allowed to do is not properly enforced, leading to unauthorized information disclosure, modification, or destruction.',
        link: 'https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control/',
    },
    {
        id: 'A02:2025',
        title: 'A02:2025 Security Misconfiguration',
        desc: 'Insecure default configurations, open ports, verbose error messages, or permissive CORS settings that leak system details or allow exploitation.',
        link: 'https://owasp.org/Top10/2025/A02_2025-Security_Misconfiguration/',
    },
    {
        id: 'A03:2025',
        title: 'A03:2025 Software Supply Chain Failures',
        desc: 'Vulnerabilities arising from insecure third-party packages, dependencies, build/test environments, or compromised software components.',
        link: 'https://owasp.org/Top10/2025/A03_2025-Software_Supply_Chain_Failures/',
    },
    {
        id: 'A04:2025',
        title: 'A04:2025 Cryptographic Failures',
        desc: 'Inadequate protection of sensitive data in transit or at rest, including weak encryption algorithms, poor key management, or insecure protocol usage.',
        link: 'https://owasp.org/Top10/2025/A04_2025-Cryptographic_Failures/',
    },
    {
        id: 'A05:2025',
        title: 'A05:2025 Injection',
        desc: 'User-supplied data is sent to an interpreter as part of a command or query, resulting in unauthorized command execution or data modification (e.g. SQLi, CRLF, Reflected XSS).',
        link: 'https://owasp.org/Top10/2025/A05_2025-Injection/',
    },
    {
        id: 'A06:2025',
        title: 'A06:2025 Insecure Design',
        desc: 'Flaws in the design, architecture, or business logic of the application, such as missing threat modeling or insecure resource consumption limits.',
        link: 'https://owasp.org/Top10/2025/A06_2025-Insecure_Design/',
    },
    {
        id: 'A07:2025',
        title: 'A07:2025 Authentication Failures',
        desc: 'Weaknesses in identifying the user\'s identity, allowing attackers to compromise authentication tokens, session IDs, or exploit credential verification steps.',
        link: 'https://owasp.org/Top10/2025/A07_2025-Authentication_Failures/',
    },
    {
        id: 'A08:2025',
        title: 'A08:2025 Software or Data Integrity Failures',
        desc: 'Applications trusting code, updates, or serialized data/objects from untrusted sources without verification (e.g. insecure deserialization, unsafe OOB interactions).',
        link: 'https://owasp.org/Top10/2025/A08_2025-Software_or_Data_Integrity_Failures/',
    },
    {
        id: 'A09:2025',
        title: 'A09:2025 Security Logging & Alerting Failures',
        desc: 'Insufficient logging, monitoring, and active detection of suspicious activities, hindering incident response and visibility.',
        link: 'https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/',
    },
    {
        id: 'A10:2025',
        title: 'A10:2025 Mishandling of Exceptional Conditions',
        desc: 'Failures in gracefully handling errors, exceptions, timeouts, or network drops, exposing detailed stack traces or database/network leaks.',
        link: 'https://owasp.org/Top10/2025/A10_2025-Mishandling_of_Exceptional_Conditions/',
    },
];

interface OWASPFindingRowProps {
    result: ResultSummary;
    finding?: AnalysisFinding;
    methodColor: string;
    onSelect: (row: ResultSummary) => void;
}

const OWASPFindingRow: React.FC<OWASPFindingRowProps> = React.memo(({ result, finding, methodColor, onSelect }) => {
    const displayPath = result.resolvedPath || result.endpoint;
    const displayDesc = finding ? finding.message : `HTTP ${result.status} Status Code Error`;

    return (
        <div
            className="owasp-finding-row"
            onClick={() => onSelect(result)}
        >
            <div className="owasp-finding-left">
                <span
                    className="owasp-finding-method"
                    style={{
                        color: methodColor,
                        border: `1px solid ${methodColor}40`,
                        background: `${methodColor}10`,
                    }}
                >
                    {result.method}
                </span>
                <div className="owasp-finding-info">
                    <span className="owasp-finding-path">{displayPath}</span>
                    <span className="owasp-finding-desc">{displayDesc}</span>
                </div>
            </div>
            <div className="owasp-finding-right">
                {finding?.cweIds?.[0] && (
                    <span className="badge badge-cwe">
                        {finding.cweIds[0]}
                    </span>
                )}
                {result.identity && (
                    <span className="owasp-finding-identity">
                        {result.identity}
                    </span>
                )}
                <span
                    style={{
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 600,
                        color: result.status >= 500 ? 'var(--color-error)' : 'var(--color-warning)',
                    }}
                >
                    HTTP {result.status}
                </span>
            </div>
        </div>
    );
});

interface Props {
    runId: string | null;
    queryResults: (opts: QueryOptions) => Promise<{ rows: ResultSummary[]; total: number }>;
    liveCount?: number;
    isRunning?: boolean;
    onSelectResult: (row: ResultSummary) => void;
    onUpdateCount?: (count: number) => void;
}

export function OWASPTop10({ runId, queryResults, isRunning = false, onSelectResult, onUpdateCount }: Props) {
    const onSelectResultRef = useRef(onSelectResult);
    onSelectResultRef.current = onSelectResult;

    const handleSelectResultStable = useCallback((row: ResultSummary) => {
        onSelectResultRef.current(row);
    }, []);

    const [rows, setRows] = useState<ResultSummary[]>([]);
    const rowsRef = useRef(rows);
    rowsRef.current = rows;

    const [isLoading, setIsLoading] = useState(false);
    const [standard, setStandard] = useState<'api_2023' | 'web_2025'>('api_2023');
    const [activeTab, setActiveTab] = useState<'cards' | 'findings'>('cards');
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [categoryLimits, setCategoryLimits] = useState<Record<string, number>>({});

    useEffect(() => {
        if (!runId) {
            setRows([]);
            return;
        }

        const fetchData = () => {
            setIsLoading(prev => prev || rowsRef.current.length === 0);
            queryResults({
                runId,
                statusFilter: 'all',
                search: '',
                limit: 2000,
                findingsOnly: true,
                identityFilter: 'all',
            })
                .then(res => {
                    setRows(res.rows);
                })
                .catch(() => {})
                .finally(() => {
                    setIsLoading(false);
                });
        };

        // Initial immediate fetch
        fetchData();

        let intervalId: NodeJS.Timeout | null = null;
        if (isRunning) {
            intervalId = setInterval(fetchData, 3000);
        }

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [runId, queryResults, isRunning]);

    const activeMetadata = useMemo(() => {
        return standard === 'api_2023' ? OWASP_API_CATEGORIES_METADATA_2023 : OWASP_CATEGORIES_METADATA;
    }, [standard]);

    const groupedData = useMemo(() => {
        const groups: Record<string, { result: ResultSummary; finding?: AnalysisFinding }[]> = {};
        for (const meta of activeMetadata) {
            groups[meta.title] = [];
        }
        groups['Unmapped / Other'] = [];

        const seenKeys = new Set<string>();

        for (const row of rows) {
            let placed = false;
            if (row.analyzerFindings && row.analyzerFindings.length > 0) {
                for (const f of row.analyzerFindings) {
                    let cats: string[] = [];
                    if (standard === 'api_2023') {
                        cats = (f.owaspApiCategory && f.owaspApiCategory.length > 0)
                            ? f.owaspApiCategory
                            : getOwaspApiCategories(f.ruleId, row.method, row.endpoint, f.evidence);
                    } else {
                        cats = (f.owaspCategory && f.owaspCategory.length > 0)
                            ? f.owaspCategory
                            : [];
                    }

                    if (cats.length > 0) {
                        for (const c of cats) {
                            if (!groups[c]) {
                                groups[c] = [];
                            }
                            const key = `${c}:${row.method}:${row.resolvedPath || row.endpoint}:${f.ruleId || ''}`;
                            if (!seenKeys.has(key)) {
                                seenKeys.add(key);
                                groups[c].push({ result: row, finding: f });
                            }
                            placed = true;
                        }
                    }
                }
            }

            if (!placed) {
                let cats: string[] = [];
                if (standard === 'api_2023') {
                    cats = (row.owaspApiCategory && row.owaspApiCategory.length > 0)
                        ? row.owaspApiCategory
                        : getOwaspApiCategories(row.status === 0 ? 'swazz/timeout' : `swazz/status-${row.status}`, row.method, row.endpoint, row.error);
                } else {
                    cats = (row.owaspCategory && row.owaspCategory.length > 0)
                        ? row.owaspCategory
                        : [];
                }

                if (cats.length > 0) {
                    for (const c of cats) {
                        if (!groups[c]) {
                            groups[c] = [];
                        }
                        const key = `${c}:${row.method}:${row.resolvedPath || row.endpoint}:status-${row.status}`;
                        if (!seenKeys.has(key)) {
                            seenKeys.add(key);
                            groups[c].push({ result: row });
                        }
                        placed = true;
                    }
                }
            }

            if (!placed) {
                const key = `Unmapped / Other:${row.method}:${row.resolvedPath || row.endpoint}:status-${row.status}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    groups['Unmapped / Other'].push({ result: row });
                }
            }
        }

        return groups;
    }, [rows, activeMetadata, standard]);

    const totalFindingsCount = useMemo(() => {
        return Object.values(groupedData).reduce((acc, list) => acc + list.length, 0);
    }, [groupedData]);

    const onUpdateCountRef = useRef(onUpdateCount);
    onUpdateCountRef.current = onUpdateCount;

    useEffect(() => {
        if (onUpdateCountRef.current) {
            onUpdateCountRef.current(totalFindingsCount);
        }
    }, [totalFindingsCount]);

    const methodColors: Record<string, string> = {
        GET: 'var(--color-primary)',
        POST: 'var(--color-success)',
        PUT: 'var(--color-warning)',
        DELETE: 'var(--color-error)',
        PATCH: '#a855f7',
        WS: '#8b5cf6',
        CALL: '#06b6d4',
        MCP: '#06b6d4',
    };

    const handleCardClick = (title: string, count: number) => {
        if (count === 0) return;
        setExpandedCategory(title);
        setActiveTab('findings');
        setTimeout(() => {
            const elementId = `accordion-${title.replace(/[^a-zA-Z0-9]/g, '-')}`;
            const el = document.getElementById(elementId);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    };

    return (
        <div className="owasp-container">
            <div className="owasp-summary-banner">
                <div className="owasp-summary-title">
                    {standard === 'api_2023' ? 'OWASP API Security Top 10 (2023) Coverage' : 'OWASP Top 10 (2025) Coverage'}
                    <a 
                        href={standard === 'api_2023' ? "https://owasp.org/API-Security/editions/2023/en/0x00-header/" : "https://owasp.org/Top10/2025/"} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="owasp-external-link"
                    >
                        Official Site ↗
                    </a>
                </div>
                <div className="owasp-summary-actions">
                    <div className="owasp-standard-toggle">
                        <button
                            className={`owasp-tab-btn ${standard === 'api_2023' ? 'active' : ''}`}
                            onClick={() => { setStandard('api_2023'); setExpandedCategory(null); }}
                        >
                            🛡️ API Security (2023)
                        </button>
                        <button
                            className={`owasp-tab-btn ${standard === 'web_2025' ? 'active' : ''}`}
                            onClick={() => { setStandard('web_2025'); setExpandedCategory(null); }}
                        >
                            🌐 Web Top 10 (2025)
                        </button>
                    </div>
                    <span className="owasp-summary-count">
                        {totalFindingsCount} Finding{totalFindingsCount === 1 ? '' : 's'} Detected
                    </span>
                    <div className="owasp-nav-tabs">
                        <button
                            className={`owasp-tab-btn ${activeTab === 'cards' ? 'active' : ''}`}
                            onClick={() => setActiveTab('cards')}
                        >
                            📊 Overview
                        </button>
                        <button
                            className={`owasp-tab-btn ${activeTab === 'findings' ? 'active' : ''}`}
                            onClick={() => setActiveTab('findings')}
                        >
                            🔍 Findings ({totalFindingsCount})
                        </button>
                    </div>
                </div>
            </div>

            {isLoading && rows.length === 0 ? (
                <div className="owasp-loading-state">
                    <div className="loading-spinner" />
                    <span>Loading OWASP findings...</span>
                </div>
            ) : totalFindingsCount === 0 ? (
                <div className="owasp-empty-state">
                    <p>No vulnerabilities classified in this scan run.</p>
                </div>
            ) : (
                <>
                    {activeTab === 'cards' && (
                        <div className="owasp-grid">
                            {activeMetadata.map(meta => {
                                const count = groupedData[meta.title]?.length || 0;
                                const hasFindings = count > 0;
                                const isActive = expandedCategory === meta.title;

                                return (
                                    <div
                                        key={meta.id}
                                        className={`owasp-card ${hasFindings ? 'has-findings' : ''} ${isActive ? 'active' : ''}`}
                                        onClick={() => handleCardClick(meta.title, count)}
                                    >
                                        <div className="owasp-card-header">
                                            <span className="owasp-card-id">{meta.id}</span>
                                            <span className={`owasp-card-badge ${hasFindings ? 'has-findings' : 'no-findings'}`}>
                                                {count} {count === 1 ? 'finding' : 'findings'}
                                            </span>
                                        </div>
                                        <div className="owasp-card-title">{meta.title.split(' ').slice(1).join(' ')}</div>
                                        <div className="owasp-card-desc">{meta.desc}</div>
                                        <div className="owasp-card-footer">
                                            <a 
                                                href={meta.link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="owasp-learn-more-link"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                Learn More ↗
                                            </a>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {activeTab === 'findings' && (
                        <div className="owasp-details-section">
                            {Object.entries(groupedData)
                                .filter(([_, items]) => items.length > 0)
                                .map(([title, items]) => {
                                    const isExpanded = expandedCategory === title;
                                    const elementId = `accordion-${title.replace(/[^a-zA-Z0-9]/g, '-')}`;
                                    const meta = activeMetadata.find(m => m.title === title);

                                    return (
                                        <div key={title} id={elementId} className="owasp-accordion">
                                            <div
                                                className="owasp-accordion-header"
                                                onClick={() => setExpandedCategory(isExpanded ? null : title)}
                                            >
                                                <div className="owasp-accordion-title">
                                                    {title} ({items.length})
                                                    {meta?.link && (
                                                        <a
                                                            href={meta.link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="owasp-accordion-link"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            Learn More ↗
                                                        </a>
                                                    )}
                                                </div>
                                                <svg
                                                    width="16"
                                                    height="16"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    className={`owasp-accordion-chevron ${isExpanded ? 'expanded' : ''}`}
                                                >
                                                    <polyline points="6 9 12 15 18 9" />
                                                </svg>
                                            </div>

                                            {isExpanded && (() => {
                                                const categoryLimit = categoryLimits[title] || 50;
                                                const visibleItems = items.slice(0, categoryLimit);
                                                return (
                                                    <div className="owasp-accordion-items">
                                                        {visibleItems.map(({ result, finding }, idx) => {
                                                            const methodColor = methodColors[result.method] || 'var(--text-muted)';
                                                            return (
                                                                <OWASPFindingRow
                                                                    key={`${result.id}-${idx}`}
                                                                    result={result}
                                                                    finding={finding}
                                                                    methodColor={methodColor}
                                                                    onSelect={handleSelectResultStable}
                                                                />
                                                            );
                                                        })}
                                                        {items.length > categoryLimit && (
                                                            <button
                                                                className="btn btn-ghost btn-sm load-more-findings"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setCategoryLimits(prev => ({
                                                                        ...prev,
                                                                        [title]: categoryLimit + 50,
                                                                    }));
                                                                }}
                                                            >
                                                                Show More (+{Math.min(50, items.length - categoryLimit)})
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
