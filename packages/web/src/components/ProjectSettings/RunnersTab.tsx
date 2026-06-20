import React from 'react';
import { useAppStore } from '../../store/appStore.js';

interface Runner {
    name: string;
    publicKey: string | null;
    status: 'authenticating' | 'connected';
    isMine: boolean;
    isShared: boolean;
    version?: string;
}

interface RunnersTabProps {
    runners: Runner[];
    isLoadingRunners: boolean;
    runnerError: string;
}

export function RunnersTab({ runners, isLoadingRunners, runnerError }: RunnersTabProps) {
    return (
        <div className="card" style={{
            backgroundColor: 'var(--bg-elevated)',
            padding: '24px',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-default)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
        }}>
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                borderBottom: '1px solid rgba(255,255,255,0.05)', 
                paddingBottom: '12px',
                flexWrap: 'wrap',
                gap: '12px'
            }}>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                    Distributed Fuzzing Agents (Runners)
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => useAppStore.setState({ activeTab: 'settings' })}
                        style={{ fontSize: '12px', padding: '6px 12px' }}
                    >
                        Register Private Runner
                    </button>
                    <span style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}>
                        <span className="dot pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
                        Live Coordinator Status
                    </span>
                </div>
            </div>

            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                View all available agent runner nodes currently connected to the central coordinator. 
                When you start a scan, the coordinator dispatches fuzz instructions to available agents, prioritizing your own matching signing keys first.
            </p>

            {isLoadingRunners && runners.length === 0 ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                    Loading active runner registry...
                </div>
            ) : runnerError ? (
                <div style={{
                    padding: '12px 16px',
                    backgroundColor: 'var(--color-error-bg)',
                    border: '1px solid rgba(244,63,94,0.25)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-error)',
                    fontSize: '13px'
                }}>
                    Error: {runnerError}
                </div>
            ) : runners.length === 0 ? (
                <div className="empty-state" style={{ padding: '32px 0', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="empty-state-icon" style={{ fontSize: '24px', marginBottom: '8px' }}>🔌</div>
                    <div className="empty-state-title" style={{ fontSize: '14px' }}>No runners connected</div>
                    <div className="empty-state-text" style={{ fontSize: '12px', maxWidth: '380px', margin: '4px auto 0 auto', textAlign: 'center' }}>
                        Scan coordinator has zero active web socket runners. Register and run a local agent on your machine.
                    </div>
                    <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => useAppStore.setState({ activeTab: 'settings' })}
                        style={{ marginTop: '16px' }}
                    >
                        Setup Local Runner
                    </button>
                </div>
            ) : (
                <div style={{
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden'
                }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-default)' }}>
                                <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>Agent Name</th>
                                <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>Public Key Hash</th>
                                <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>Mode</th>
                                <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>Owner</th>
                                <th style={{ padding: '10px 16px', fontWeight: 500, color: 'var(--text-secondary)' }}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runners.map((r, i) => (
                                <tr key={r.publicKey || r.name} style={{ borderBottom: i === runners.length - 1 ? 'none' : '1px solid var(--border-subtle)', backgroundColor: r.isMine ? 'rgba(124,58,237,0.03)' : 'transparent' }}>
                                    <td style={{ padding: '12px 16px', fontWeight: 500 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span className="runner-name">{r.name}</span>
                                            {r.version && (
                                                <span className="runner-version-badge" style={{
                                                    fontSize: '11px',
                                                    color: 'var(--text-muted)',
                                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    border: '1px solid var(--border-default)'
                                                }}>
                                                    {r.version}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)' }}>
                                        {r.publicKey ? `${r.publicKey.substring(0, 16)}...` : 'Anonymous'}
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>
                                        {(r.isShared ?? !r.publicKey) ? (
                                            <span style={{
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                color: 'var(--text-secondary)',
                                                backgroundColor: 'var(--border-default)',
                                                padding: '2px 8px',
                                                borderRadius: '12px'
                                            }}>Shared</span>
                                        ) : (
                                            <span style={{
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                color: 'var(--accent-light)',
                                                backgroundColor: 'var(--accent-subtle)',
                                                padding: '2px 8px',
                                                borderRadius: '12px',
                                                border: '1px solid rgba(167, 139, 250, 0.15)'
                                            }}>Private</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>
                                        {r.isMine ? (
                                            <span style={{
                                                fontSize: '11px',
                                                fontWeight: 600,
                                                color: 'var(--color-success)',
                                                backgroundColor: 'rgba(34,211,160,0.12)',
                                                padding: '2px 8px',
                                                borderRadius: '12px'
                                            }}>You</span>
                                        ) : (
                                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Shared Pool</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span className={`dot ${r.status === 'connected' ? 'pulse' : ''}`} style={{
                                                width: '6px',
                                                height: '6px',
                                                borderRadius: '50%',
                                                backgroundColor: r.status === 'connected' ? 'var(--color-success)' : 'var(--color-warning)'
                                            }} />
                                            <span style={{
                                                fontSize: '12px',
                                                color: r.status === 'connected' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                textTransform: 'capitalize'
                                            }}>{r.status}</span>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
