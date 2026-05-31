import { useState, useEffect, useMemo } from 'react';
import type { ResultSummary } from '../../hooks/useRunner.js';
import type { QueryOptions } from '../../hooks/useDb.js';
import type { AnalysisFinding } from '../../types.js';
import './OWASPTop10.css';

const OWASP_CATEGORIES_METADATA = [
    {
        id: 'API1:2023',
        title: 'API1:2023 Broken Object Level Authorization',
        desc: 'APIs tend to expose endpoints that handle object identifiers, creating a wide attack surface level access control issue.',
    },
    {
        id: 'API2:2023',
        title: 'API2:2023 Broken Authentication',
        desc: 'Authentication mechanisms are often implemented incorrectly, allowing attackers to compromise authentication tokens or exploit implementation flaws.',
    },
    {
        id: 'API3:2023',
        title: 'API3:2023 Broken Object Property Level Authorization',
        desc: 'This category combines Excessive Data Exposure and Mass Assignment, focusing on lack of validation for user access to specific object properties.',
    },
    {
        id: 'API4:2023',
        title: 'API4:2023 Unrestricted Resource Consumption',
        desc: 'Lack of rate limiting or resource restriction allows attackers to cause denial of service or high operational costs.',
    },
    {
        id: 'API5:2023',
        title: 'API5:2023 Broken Function Level Authorization',
        desc: 'Missing authorization checks at the function or endpoint level, allowing regular users to execute administrative functions.',
    },
    {
        id: 'API6:2023',
        title: 'API6:2023 Unrestricted Access to Sensitive Business Flows',
        desc: 'Exposing sensitive business flows without rate limits or bot protections, permitting automated abuse.',
    },
    {
        id: 'API7:2023',
        title: 'API7:2023 Server-Side Request Forgery',
        desc: 'API fetches a remote resource without validating the user-supplied URI, allowing SSRF.',
    },
    {
        id: 'API8:2023',
        title: 'API8:2023 Security Misconfiguration',
        desc: 'Verbose error messages, stack trace leaks, CORS wildcard misconfigurations, or lack of security headers.',
    },
    {
        id: 'API9:2023',
        title: 'API9:2023 Improper Inventory Management',
        desc: 'Outdated API versions, lack of documentation, or shadow APIs that lack proper controls.',
    },
    {
        id: 'API10:2023',
        title: 'API10:2023 Unsafe Consumption of APIs',
        desc: 'Trusting data received from other APIs without proper verification, leading to downstream security vulnerabilities.',
    }
];

interface Props {
    runId: string | null;
    queryResults: (opts: QueryOptions) => Promise<{ rows: ResultSummary[]; total: number }>;
    liveCount?: number;
    onSelectResult: (row: ResultSummary) => void;
}

export function OWASPTop10({ runId, queryResults, liveCount = 0, onSelectResult }: Props) {
    const [rows, setRows] = useState<ResultSummary[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

    useEffect(() => {
        if (!runId) {
            setRows([]);
            return;
        }

        setIsLoading(true);
        const timer = setTimeout(() => {
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
        }, 1000); // Debounce database queries by 1 second to prevent UI freezing during active runs

        return () => clearTimeout(timer);
    }, [runId, queryResults, liveCount]);

    const groupedData = useMemo(() => {
        const groups: Record<string, { result: ResultSummary; finding?: AnalysisFinding }[]> = {};
        for (const meta of OWASP_CATEGORIES_METADATA) {
            groups[meta.title] = [];
        }
        groups['Unmapped / Other'] = [];

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
                            groups[c].push({ result: row, finding: f });
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
                        groups[c].push({ result: row });
                        placed = true;
                    }
                }
            }

            if (!placed) {
                groups['Unmapped / Other'].push({ result: row });
            }
        }

        return groups;
    }, [rows]);

    const totalFindingsCount = useMemo(() => {
        return Object.values(groupedData).reduce((sum, list) => sum + list.length, 0);
    }, [groupedData]);

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
                <div className="owasp-summary-title">OWASP API Security Top 10 (2023) Coverage</div>
                <div className="owasp-summary-count">
                    {totalFindingsCount} {totalFindingsCount === 1 ? 'Finding' : 'Findings'} Detected
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

                                return (
                                    <div key={title} id={elementId} className="owasp-accordion">
                                        <div
                                            className="owasp-accordion-header"
                                            onClick={() => setExpandedCategory(isExpanded ? null : title)}
                                        >
                                            <div className="owasp-accordion-title">
                                                {title} ({items.length})
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

                                        {isExpanded && (
                                            <div className="owasp-accordion-items">
                                                {items.map(({ result, finding }, idx) => {
                                                    const methodColor = methodColors[result.method] || 'var(--text-muted)';
                                                    const displayPath = result.resolvedPath || result.endpoint;
                                                    const displayDesc = finding
                                                        ? finding.message
                                                        : `HTTP ${result.status} Status Code Error`;

                                                    return (
                                                        <div
                                                            key={`${result.id}-${idx}`}
                                                            className="owasp-finding-row"
                                                            onClick={() => onSelectResult(result)}
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
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                    </div>
                </>
            )}
        </div>
    );
}
