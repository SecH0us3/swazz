import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth.js';

interface LogEntry {
  id: string;
  scan_id: string;
  type: string;
  payload: string; // JSON string of { level, message, timestamp }
  created_at: string;
}

interface RunnerLog {
  level: string;
  message: string;
  timestamp: string;
}

export function RunnerLogsViewer({ runId, isRunning }: { runId: string | null; isRunning?: boolean }) {
  const [logs, setLogs] = useState<RunnerLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { token } = useAuth();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [minLevel, setMinLevel] = useState<'INFO' | 'WARN' | 'ERROR'>('WARN');

  useEffect(() => {
    if (!runId) {
      setLogs([]);
      return;
    }

    let active = true;

    const fetchLogs = async () => {
      setLoading(true);
      setError(null);
      try {
        const headers: Record<string, string> = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const res = await fetch(`/api/scans/${runId}/runner-logs`, { headers });
        if (res.status === 404) {
          if (active) {
            setLogs([]);
            // Don't show an error for 404, just leave it empty
          }
          return;
        }
        if (!res.ok) {
          throw new Error('Failed to fetch runner logs');
        }
        const data = await res.json();
        if (active && data.logs) {
          const parsedLogs = data.logs.map((log: LogEntry) => {
            try {
              const parsed = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
              const logData = parsed.data || parsed;
              return {
                level: logData.level || 'INFO',
                message: logData.message || '',
                timestamp: logData.timestamp || log.created_at,
              };
            } catch {
              return { level: 'INFO', message: String(log.payload), timestamp: log.created_at };
            }
          });
          setLogs(parsedLogs);
        }
      } catch (err: any) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    };

    
    let timer: any;
    const poll = async () => {
      await fetchLogs();
      if (active && isRunning) {
        timer = setTimeout(poll, 3000);
      }
    };

    if (isRunning) {
      poll();
    } else {
      fetchLogs();
    }

    return () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [runId, token, isRunning]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
    setAutoScroll(isAtBottom);
  };

  const getLogColor = (level: string) => {
    switch (level?.toUpperCase()) {
      case 'ERROR': return 'var(--danger)';
      case 'WARN': 
      case 'WARNING': return 'var(--warning)';
      case 'DEBUG': return 'var(--text-muted)';
      default: return 'var(--text-normal)';
    }
  };

  const levelScore: Record<string, number> = { 'DEBUG': -1, 'INFO': 0, 'WARN': 1, 'WARNING': 1, 'ERROR': 2 };
  const minLevelScore = levelScore[minLevel] || 0;
  
  const filteredLogs = logs.filter(log => {
    const score = levelScore[log.level.toUpperCase()] || 0;
    return score >= minLevelScore;
  });

  if (!runId) {
    return <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)' }}>No scan selected.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-3)', borderBottom: '1px solid var(--border-default)', background: 'var(--bg-elevated)', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-size-md)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          Runner Logs
        </h3>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {minLevel === 'WARN' && (
            <span style={{ color: 'var(--warning)', fontSize: 'var(--font-size-xs)', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
              ⚠️ Showing warnings+ only
            </span>
          )}
          <select 
            className="input input-sm" 
            value={minLevel} 
            onChange={(e) => setMinLevel(e.target.value as 'INFO' | 'WARN' | 'ERROR')}
            style={{ padding: '2px 8px', fontSize: 'var(--font-size-xs)', height: '24px', backgroundColor: 'var(--bg-default)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)' }}
          >
            <option value="INFO">All logs (Info)</option>
            <option value="WARN">Warnings & Errors</option>
            <option value="ERROR">Errors only</option>
          </select>
          <button 
            className={`btn btn-sm ${autoScroll ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setAutoScroll(!autoScroll)}
            style={{ height: '24px', padding: '0 8px', fontSize: 'var(--font-size-xs)' }}
          >
            {autoScroll ? 'Auto-scroll On' : 'Auto-scroll Off'}
          </button>
        </div>
      </div>
      
      <div 
        style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', backgroundColor: '#0f111a', color: '#a6accd' }}
        onScroll={handleScroll}
      >
        {loading && logs.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Loading logs...</div>}
        {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        
        {filteredLogs.map((log, i) => (
          <div key={i} style={{ marginBottom: '4px', display: 'flex', gap: '12px', wordBreak: 'break-all' }}>
            <span style={{ color: '#4c566a', flexShrink: 0, minWidth: '85px' }}>
              {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span style={{ color: getLogColor(log.level), flexShrink: 0, minWidth: '45px' }}>
              [{log.level.toUpperCase() === 'WARNING' ? 'WARN' : log.level.toUpperCase()}]
            </span>
            <span style={{ color: getLogColor(log.level) }}>{log.message}</span>
          </div>
        ))}
        {filteredLogs.length === 0 && logs.length > 0 && <div style={{ color: 'var(--text-muted)' }}>Logs exist, but are hidden by the current filter.</div>}
        {logs.length === 0 && !loading && !error && <div style={{ color: 'var(--text-muted)' }}>No logs found for this scan.</div>}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}
