import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useToast } from '../../hooks/useToast.js';
import { Webhook } from '../../types.js';

interface WebhookFormState {
    id?: string;
    url: string;
    headers: string; // string representation of JSON headers
    event_types: string[];
}

export function WebhooksTab() {
    const activeProject = useAppStore(state => state.activeProject);
    const { showToast } = useToast();

    const [webhooks, setWebhooks] = useState<Webhook[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState<string | null>(null);
    const [showForm, setShowForm] = useState(false);
    const [formState, setFormState] = useState<WebhookFormState>({
        url: '',
        headers: '{\n  "Authorization": "Bearer token_here"\n}',
        event_types: ['scan.completed', 'finding.triaged']
    });

    const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;

    const availableEvents = [
        { key: 'scan.started', label: 'Scan Started', desc: 'Triggered when a fuzzer scan run is dispatched to an active agent.' },
        { key: 'scan.completed', label: 'Scan Completed', desc: 'Triggered when a fuzzer scan run finishes successfully.' },
        { key: 'scan.failed', label: 'Scan Failed', desc: 'Triggered when a fuzzer scan run encounters errors and fails.' },
        { key: 'finding.triaged', label: 'AI Triage / Patch Generated', desc: 'Triggered when AI classification or patch validation completes.' }
    ];

    const fetchWebhooks = async () => {
        if (!activeProject || !token) return;
        setIsLoading(true);
        try {
            const res = await fetch(`/api/projects/${activeProject.id}/webhooks`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setWebhooks(data.webhooks || []);
            } else {
                showToast('Failed to load webhook configurations', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Failed to load webhooks', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchWebhooks();
    }, [activeProject, token]);

    const handleEventToggle = (eventKey: string) => {
        setFormState(prev => {
            const current = [...prev.event_types];
            const idx = current.indexOf(eventKey);
            if (idx > -1) {
                current.splice(idx, 1);
            } else {
                current.push(eventKey);
            }
            return { ...prev, event_types: current };
        });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeProject || !token) return;

        // Validation
        if (!formState.url.trim()) {
            showToast('Target URL is required', 'error');
            return;
        }
        try {
            new URL(formState.url);
        } catch {
            showToast('Invalid target URL format', 'error');
            return;
        }

        let parsedHeaders: Record<string, string> | null = null;
        if (formState.headers.trim()) {
            try {
                parsedHeaders = JSON.parse(formState.headers);
                if (typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) {
                    throw new Error();
                }
            } catch {
                showToast('Headers must be a valid JSON object', 'error');
                return;
            }
        }

        if (formState.event_types.length === 0) {
            showToast('Select at least one event type to trigger the webhook', 'error');
            return;
        }

        setIsSaving(true);
        try {
            const method = formState.id ? 'PUT' : 'POST';
            const url = formState.id 
                ? `/api/projects/${activeProject.id}/webhooks/${formState.id}`
                : `/api/projects/${activeProject.id}/webhooks`;

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    url: formState.url.trim(),
                    headers: parsedHeaders ? JSON.stringify(parsedHeaders) : null,
                    event_types: formState.event_types
                })
            });

            if (res.ok) {
                showToast(formState.id ? 'Webhook updated successfully' : 'Webhook created successfully', 'success');
                setShowForm(false);
                setFormState({
                    url: '',
                    headers: '{\n  "Authorization": "Bearer token_here"\n}',
                    event_types: ['scan.completed', 'finding.triaged']
                });
                fetchWebhooks();
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to save webhook settings', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Failed to save webhook settings', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleEdit = (webhook: Webhook) => {
        let headersFormatted = '';
        if (webhook.headers) {
            try {
                headersFormatted = JSON.stringify(JSON.parse(webhook.headers), null, 2);
            } catch {}
        }

        let parsedEvents: string[] = [];
        if (webhook.event_types) {
            try {
                parsedEvents = typeof webhook.event_types === 'string'
                    ? JSON.parse(webhook.event_types)
                    : webhook.event_types;
            } catch {}
        }

        setFormState({
            id: webhook.id,
            url: webhook.url,
            headers: headersFormatted,
            event_types: parsedEvents
        });
        setShowForm(true);
    };

    const handleDelete = async (webhookId: string) => {
        if (!activeProject || !token) return;
        if (!window.confirm('Are you sure you want to delete this webhook?')) return;

        try {
            const res = await fetch(`/api/projects/${activeProject.id}/webhooks/${webhookId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (res.ok) {
                showToast('Webhook deleted successfully', 'success');
                fetchWebhooks();
            } else {
                const data = await res.json();
                showToast(data.error || 'Failed to delete webhook', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Failed to delete webhook', 'error');
        }
    };

    const handleTest = async (webhookId: string) => {
        if (!activeProject || !token) return;

        setIsTesting(webhookId);
        try {
            const res = await fetch(`/api/projects/${activeProject.id}/webhooks/${webhookId}/test`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const data = await res.json();
            if (res.ok) {
                showToast(`Test payload sent successfully. Status code: ${data.statusCode}`, 'success');
            } else {
                showToast(data.error || 'Webhook test failed', 'error');
            }
        } catch (err: any) {
            showToast(err.message || 'Webhook test failed', 'error');
        } finally {
            setIsTesting(null);
        }
    };

    if (isLoading) {
        return (
            <div className="webhooks-tab-container">
                <div className="spinner-container">
                    <div className="spinner" />
                    <span>Loading webhook configurations...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="webhooks-tab-container">
            <div className="webhooks-tab-header">
                <div>
                    <h3 className="webhooks-header">Outbound Webhooks</h3>
                    <p className="webhooks-subheader">
                        Deliver real-time JSON payloads to external URLs when scans update or vulnerabilities are discovered.
                    </p>
                </div>
                {!showForm && (
                    <button 
                        className="btn btn--primary webhooks-add-btn"
                        onClick={() => {
                            setFormState({
                                url: '',
                                headers: '{\n  "Authorization": "Bearer token_here"\n}',
                                event_types: ['scan.completed', 'finding.triaged']
                            });
                            setShowForm(true);
                        }}
                    >
                        Add Webhook
                    </button>
                )}
            </div>

            {showForm ? (
                <form className="webhook-form" onSubmit={handleSave}>
                    <h4 className="webhook-form-title">{formState.id ? 'Edit Webhook' : 'Create New Webhook'}</h4>
                    
                    <div className="webhook-form-group">
                        <label className="webhook-form-label">Target URL</label>
                        <input
                            type="text"
                            className="input webhook-url-input"
                            placeholder="https://my-api.com/webhooks/swazz"
                            value={formState.url}
                            onChange={(e) => setFormState(prev => ({ ...prev, url: e.target.value }))}
                            required
                        />
                        <span className="webhook-form-hint">
                            Must be a valid HTTP/HTTPS endpoint capable of handling POST requests.
                        </span>
                    </div>

                    <div className="webhook-form-group">
                        <label className="webhook-form-label">Custom HTTP Headers (JSON Object)</label>
                        <textarea
                            className="textarea webhook-headers-textarea"
                            rows={5}
                            value={formState.headers}
                            onChange={(e) => setFormState(prev => ({ ...prev, headers: e.target.value }))}
                            placeholder='{ "Authorization": "Bearer token" }'
                        />
                        <span className="webhook-form-hint">
                            Optional. Add custom headers (like auth tokens or secret signatures) to include in outbound HTTP posts.
                        </span>
                    </div>

                    <div className="webhook-form-group">
                        <label className="webhook-form-label">Trigger Events</label>
                        <div className="webhook-events-list">
                            {availableEvents.map(event => {
                                const checked = formState.event_types.includes(event.key);
                                return (
                                    <label key={event.key} className="webhook-event-checkbox-label">
                                        <input
                                            type="checkbox"
                                            className="webhook-event-checkbox"
                                            checked={checked}
                                            onChange={() => handleEventToggle(event.key)}
                                        />
                                        <div className="webhook-event-info">
                                            <span className="webhook-event-name">{event.label}</span>
                                            <span className="webhook-event-desc">{event.desc}</span>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    <div className="webhook-form-actions">
                        <button 
                            type="button" 
                            className="btn btn-secondary webhook-cancel-btn"
                            onClick={() => setShowForm(false)}
                            disabled={isSaving}
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            className="btn btn--primary webhook-submit-btn"
                            disabled={isSaving}
                        >
                            {isSaving ? 'Saving...' : 'Save Configuration'}
                        </button>
                    </div>
                </form>
            ) : (
                <div className="webhooks-list-container">
                    {webhooks.length === 0 ? (
                        <div className="webhooks-empty-state">
                            <p>No webhooks configured for this project yet.</p>
                        </div>
                    ) : (
                        <div className="webhooks-grid">
                            {webhooks.map(webhook => {
                                const events: string[] = [];
                                try {
                                    const parsed = typeof webhook.event_types === 'string'
                                        ? JSON.parse(webhook.event_types)
                                        : webhook.event_types;
                                    if (Array.isArray(parsed)) {
                                        events.push(...parsed);
                                    }
                                } catch {}

                                return (
                                    <div key={webhook.id} className="webhook-card">
                                        <div className="webhook-card-header">
                                            <span className="webhook-card-url" title={webhook.url}>{webhook.url}</span>
                                            <div className="webhook-card-actions">
                                                <button
                                                    className="btn btn-secondary btn-sm webhook-test-btn"
                                                    disabled={isTesting !== null}
                                                    onClick={() => handleTest(webhook.id)}
                                                >
                                                    {isTesting === webhook.id ? 'Testing...' : 'Test Connection'}
                                                </button>
                                                <button
                                                    className="btn btn-secondary btn-sm webhook-edit-btn"
                                                    onClick={() => handleEdit(webhook)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    className="btn btn-danger btn-sm webhook-delete-btn"
                                                    onClick={() => handleDelete(webhook.id)}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                        <div className="webhook-card-details">
                                            <div className="webhook-detail-group">
                                                <span className="webhook-detail-label">Active Events:</span>
                                                <div className="webhook-badge-list">
                                                    {events.map(ev => (
                                                        <span key={ev} className="webhook-badge">{ev}</span>
                                                    ))}
                                                </div>
                                            </div>
                                            {webhook.headers && (
                                                <div className="webhook-detail-group">
                                                    <span className="webhook-detail-label">Custom Headers:</span>
                                                    <span className="webhook-headers-badge">Configured</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
