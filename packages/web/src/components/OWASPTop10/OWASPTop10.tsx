import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { ResultSummary } from '../../hooks/useRunner.js';
import type { QueryOptions } from '../../hooks/useDb.js';
import type { AnalysisFinding } from '../../types.js';
import './OWASPTop10.css';

const OWASP_CATEGORIES_METADATA = [
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
    }
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

export function OWASPTop10({ runId, queryResults, liveCount = 0, isRunning = false, onSelectResult, onUpdateCount }: Props) {
    const onSelectResultRef = useRef(onSelectResult);
    onSelectResultRef.current = onSelectResult;

    const handleSelectResultStable = useCallback((row: ResultSummary) => {
        onSelectResultRef.current(row);
    }, []);

    const [rows, setRows] = useState<ResultSummary[]>([]);
    const rowsRef = useRef(rows);
    rowsRef.current = rows;

    const [isLoading, setIsLoading] = useState(false);
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

    const groupedData = useMemo(() => {
        const groups: Record<string, { result: ResultSummary; finding?: AnalysisFinding }[]> = {};
        for (const meta of OWASP_CATEGORIES_METADATA) {
            groups[meta.title] = [];
        }
        groups['Unmapped / Other'] = [];

        const seenKeys = new Set<string>();

        for (const row of rows) {
            let placed = false;
            if (row.analyzerFindings && row.analyzerFindings.length > 0) {
                for (const f of row.analyzerFindings) {
                    const cats = f.owaspCategory || [];
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
                const cats = row.owaspCategory || [];
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
    }, [rows]);

    const totalFindingsCount = useMemo(() => {
        return Object.values(groupedData).reduce((sum, list) => sum + list.length, 0);
    }, [groupedData]);

    useEffect(() => {
        if (onUpdateCount) {
            onUpdateCount(totalFindingsCount);
        }
    }, [totalFindingsCount, onUpdateCount]);

    const handleExportOwaspReport = () => {
        const reportData = {
            runId,
            timestamp: new Date().toISOString(),
            totalFindings: totalFindingsCount,
            categories: Object.entries(groupedData)
                .filter(([_, items]) => items.length > 0)
                .map(([category, items]) => ({
                    category,
                    count: items.length,
                    findings: items.map(item => ({
                        method: item.result.method,
                        endpoint: item.result.endpoint,
                        resolvedPath: item.result.resolvedPath,
                        status: item.result.status,
                        identity: item.result.identity,
                        message: item.finding?.message || `HTTP ${item.result.status} Status Code Error`,
                        severity: item.finding?.level || (item.result.status >= 500 ? 'error' : 'warning')
                    }))
                }))
        };

        const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `swazz-owasp-report-${runId || 'live'}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const methodColors: Record<string, string> = {
        GET: 'var(--method-get)',
        POST: 'var(--method-post)',
        PUT: 'var(--method-put)',
        PATCH: 'var(--method-patch)',
        DELETE: 'var(--method-delete)',
    };

    const handleCardClick = (title: string, count: number) => {
        if (count > 0) {
            setExpandedCategory(expandedCategory === title ? null : title);
            // Scroll to the accordion element
            const el = document.getElementById(`accordion-${title.replace(/[^a-zA-Z0-9]/g, '-')}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    };

    return (
        <div className="owasp-container">
            <div className="owasp-summary-banner">
                 <div className="owasp-summary-title">
                     OWASP Top 10 (2025) Coverage
                     <a 
                         href="https://owasp.org/Top10/2025/" 
                         target="_blank" 
                         rel="noopener noreferrer"
                         className="owasp-external-link"
                     >
                         Official Site ↗
                     </a>
                 </div>
                <div className="owasp-summary-actions">
                    <div className="owasp-summary-count">
                        {totalFindingsCount} {totalFindingsCount === 1 ? 'Finding' : 'Findings'} Detected
                    </div>
                    <button
                        onClick={handleExportOwaspReport}
                        className="btn btn-ghost btn-sm btn-owasp-export"
                        disabled={totalFindingsCount === 0}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="export-icon">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Export Report
                    </button>
                </div>
            </div>

            {isLoading && rows.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
                    <span className="text-muted">Loading findings and categorizing...</span>
                </div>
            ) : (
                <>
                    <div className="owasp-grid">
                        {OWASP_CATEGORIES_METADATA.map(meta => {
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

                    <div className="owasp-details-section">
                        {Object.entries(groupedData)
                            .filter(([_, items]) => items.length > 0)
                            .map(([title, items]) => {
                                const isExpanded = expandedCategory === title;
                                const elementId = `accordion-${title.replace(/[^a-zA-Z0-9]/g, '-')}`;
                                const meta = OWASP_CATEGORIES_METADATA.find(m => m.title === title);

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
                                                style={{
                                                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                                    transition: 'transform 0.2s ease',
                                                }}
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
                                                             style={{ width: '100%', margin: 'var(--space-2) 0' }}
                                                             onClick={(e) => {
                                                                 e.stopPropagation();
                                                                 setCategoryLimits(prev => ({
                                                                     ...prev,
                                                                     [title]: categoryLimit + 50
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
                </>
            )}
        </div>
    );
}
