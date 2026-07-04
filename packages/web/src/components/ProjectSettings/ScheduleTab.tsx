import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useToast } from '../../hooks/useToast.js';

export function ScheduleTab() {
    const activeProject = useAppStore(state => state.activeProject);
    const userProfile = useAppStore(state => state.userProfile);
    const { showToast } = useToast();

    const [scheduleType, setScheduleType] = useState<'disabled' | 'daily' | 'weekly' | 'custom'>('disabled');
    const [customCron, setCustomCron] = useState('0 0 * * *');
    const [lastRunAt, setLastRunAt] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
    const isSupporter = userProfile?.plan === 'Supporter Plan';

    useEffect(() => {
        if (!activeProject || !token) return;

        let active = true;
        const fetchSchedule = async () => {
            setIsLoading(true);
            try {
                const res = await fetch(`/api/projects/${activeProject.id}/config`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok && active) {
                    const data = await res.json();
                    const cron = data.cron_schedule;
                    setLastRunAt(data.last_run_at || null);
                    
                    if (!cron) {
                        setScheduleType('disabled');
                    } else if (cron === '0 0 * * *') {
                        setScheduleType('daily');
                    } else if (cron === '0 0 * * 0') {
                        setScheduleType('weekly');
                    } else {
                        setScheduleType('custom');
                        setCustomCron(cron);
                    }
                }
            } catch (err) {
                console.warn('[swazz] Failed to load schedule config:', err);
            } finally {
                if (active) setIsLoading(false);
            }
        };

        fetchSchedule();
        return () => {
            active = false;
        };
    }, [activeProject, token]);

    const handleSave = async () => {
        if (!activeProject || !token) return;

        let cronExpr: string | null = null;
        if (scheduleType === 'daily') {
            cronExpr = '0 0 * * *';
        } else if (scheduleType === 'weekly') {
            cronExpr = '0 0 * * 0';
        } else if (scheduleType === 'custom') {
            cronExpr = customCron.trim();
        }

        // Basic client-side validation
        if (scheduleType === 'custom' && cronExpr) {
            const parts = cronExpr.split(/\s+/);
            if (parts.length !== 5) {
                showToast('Invalid cron expression. Must have exactly 5 fields.', 'error');
                return;
            }
            const minute = parts[0];
            const hour = parts[1];
            const isSingleMinute = /^\d+$/.test(minute) && parseInt(minute, 10) >= 0 && parseInt(minute, 10) <= 59;
            const isSingleHour = /^\d+$/.test(hour) && parseInt(hour, 10) >= 0 && parseInt(hour, 10) <= 23;
            if (!isSingleMinute || !isSingleHour) {
                showToast('Frequency limit: schedule cannot be more frequent than once a day (minute and hour fields must be specific single integer constants).', 'error');
                return;
            }
        }

        setIsSaving(true);
        try {
            const res = await fetch(`/api/projects/${activeProject.id}/schedule`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ cron_schedule: cronExpr })
            });

            if (res.ok) {
                showToast('Schedule settings saved successfully', 'success');
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to save schedule settings', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Failed to save schedule settings', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isSupporter) {
        return (
            <div className="schedule-tab-container">
                <h3 className="schedule-header">Auto-Scan Scheduler</h3>
                <div className="schedule-upgrade-banner">
                    <span className="schedule-upgrade-title">Premium Feature: Scheduled Auto-Scans</span>
                    <p className="schedule-upgrade-text">
                        Automate your vulnerability detection. Set up daily, weekly, or custom cron intervals to automatically scan your endpoints for OWASP top 10 vulnerabilities, BOLA, and rate-limiting flaws.
                    </p>
                    <div className="schedule-upgrade-footer">
                        <span className="badge badge--accent">Supporter Plan Required</span>
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="schedule-tab-container">
                <div className="spinner-container">
                    <div className="spinner" />
                    <span>Loading schedule settings...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="schedule-tab-container">
            <h3 className="schedule-header">Auto-Scan Scheduler</h3>
            
            <div className="schedule-form-group">
                <div>
                    <label className="schedule-label">Schedule Frequency</label>
                    <select
                        className="select schedule-select"
                        value={scheduleType}
                        onChange={(e) => setScheduleType(e.target.value as any)}
                    >
                        <option value="disabled">Disabled</option>
                        <option value="daily">Daily (At 00:00 UTC)</option>
                        <option value="weekly">Weekly (At 00:00 UTC on Sunday)</option>
                        <option value="custom">Custom Cron Expression</option>
                    </select>
                </div>

                {scheduleType === 'custom' && (
                    <div>
                        <label className="schedule-label">Cron Expression (UTC)</label>
                        <input
                            type="text"
                            className="input schedule-input"
                            value={customCron}
                            onChange={(e) => setCustomCron(e.target.value)}
                            placeholder="e.g. 0 12 * * *"
                        />
                        <span className="schedule-hint">
                            Format: minute hour day-of-month month day-of-week (e.g. '0 12 * * *' for daily at 12:00 UTC).
                        </span>
                        <span className="schedule-hint">
                            Note: Frequencies higher than once per day (24 hours) are not allowed. Minute and hour fields must be exact integers.
                        </span>
                    </div>
                )}

                <button
                    className="btn btn--primary schedule-save-btn"
                    disabled={isSaving}
                    onClick={handleSave}
                >
                    {isSaving ? 'Saving...' : 'Save Schedule'}
                </button>
            </div>

            {lastRunAt && (
                <div className="schedule-last-run">
                    Last automatic run triggered at: <strong>{new Date(lastRunAt).toLocaleString()}</strong>
                </div>
            )}
        </div>
    );
}
