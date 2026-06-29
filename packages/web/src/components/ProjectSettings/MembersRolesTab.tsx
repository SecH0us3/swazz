import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { useToast } from '../../hooks/useToast.js';

interface Role {
    id: string;
    name: string;
    is_default: boolean;
    permissions: string[];
    included_roles: string[];
}

interface Member {
    id: string;
    username: string;
    email: string;
    roles: string[];
}

export function MembersRolesTab() {
    const activeProject = useAppStore(state => state.activeProject);
    const { showToast } = useToast();
    const [view, setView] = useState<'members' | 'roles'>('members');
    const [members, setMembers] = useState<Member[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [permissions, setPermissions] = useState<Record<string, string>>({});
    
    // Invitation State
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteInput, setInviteInput] = useState('');
    const [selectedInviteRoles, setSelectedInviteRoles] = useState<string[]>([]);
    
    // Custom Role State
    const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
    const [roleName, setRoleName] = useState('');
    const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
    const [selectedInheritedRoles, setSelectedInheritedRoles] = useState<string[]>([]);

    useEffect(() => {
        if (!activeProject) return;
        fetchPermissions();
        fetchRoles();
        fetchMembers();
    }, [activeProject]);

    const getHeaders = () => {
        const token = localStorage.getItem('swazz_token');
        return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    };

    const fetchPermissions = async () => {
        const res = await fetch(`/api/projects/${activeProject?.id}/permissions`, { headers: getHeaders() });
        if (res.ok) {
            const data = await res.json();
            setPermissions(data.permissions);
        }
    };

    const fetchRoles = async () => {
        const res = await fetch(`/api/projects/${activeProject?.id}/roles`, { headers: getHeaders() });
        if (res.ok) {
            const data = await res.json();
            setRoles(data.roles);
        }
    };

    const fetchMembers = async () => {
        const res = await fetch(`/api/projects/${activeProject?.id}/members`, { headers: getHeaders() });
        if (res.ok) {
            const data = await res.json();
            setMembers(data.members);
        }
    };

    const handleInvite = async () => {
        const isEmail = inviteInput.includes('@');
        const payload = {
            roles: selectedInviteRoles,
            ...(isEmail ? { email: inviteInput } : { username: inviteInput })
        };
        const res = await fetch(`/api/projects/${activeProject?.id}/invitations`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            setIsInviteModalOpen(false);
            setInviteInput('');
            setSelectedInviteRoles([]);
            showToast('Invitation sent (Check server logs for token)', 'success');
        } else {
            showToast('Failed to send invitation', 'error');
        }
    };

    const handleCreateRole = async () => {
        const res = await fetch(`/api/projects/${activeProject?.id}/roles`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                name: roleName,
                permissions: selectedPermissions,
                included_roles: selectedInheritedRoles
            })
        });
        if (res.ok) {
            setIsRoleModalOpen(false);
            setRoleName('');
            setSelectedPermissions([]);
            setSelectedInheritedRoles([]);
            fetchRoles();
            showToast('Custom role created', 'success');
        } else {
            showToast('Failed to create role', 'error');
        }
    };

    return (
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: 'var(--text-default)' }}>Access & Permissions</h3>
                <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-input)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
                    <button 
                        onClick={() => setView('members')}
                        style={{ padding: '6px 12px', background: view === 'members' ? 'var(--bg-card)' : 'transparent', border: 'none', color: view === 'members' ? 'var(--text-default)' : 'var(--text-muted)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                    >Members</button>
                    <button 
                        onClick={() => setView('roles')}
                        style={{ padding: '6px 12px', background: view === 'roles' ? 'var(--bg-card)' : 'transparent', border: 'none', color: view === 'roles' ? 'var(--text-default)' : 'var(--text-muted)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                    >Roles</button>
                </div>
            </div>

            {view === 'members' && (
                <>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn btn-primary" onClick={() => setIsInviteModalOpen(true)}>Invite User</button>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                                <th style={{ padding: '12px' }}>User</th>
                                <th style={{ padding: '12px' }}>Roles</th>
                            </tr>
                        </thead>
                        <tbody>
                            {members.map(m => (
                                <tr key={m.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                    <td style={{ padding: '12px' }}>{m.username || m.email}</td>
                                    <td style={{ padding: '12px', display: 'flex', gap: '4px' }}>
                                        {m.roles.map(r => {
                                            const roleDef = roles.find(role => role.id === r);
                                            return <span key={r} style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{roleDef ? roleDef.name : r}</span>
                                        })}
                                    </td>
                                </tr>
                            ))}
                            {members.length === 0 && (
                                <tr>
                                    <td colSpan={2} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>No members found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </>
            )}

            {view === 'roles' && (
                <>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button className="btn btn-primary" onClick={() => setIsRoleModalOpen(true)}>Create Custom Role</button>
                    </div>
                    <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                        {roles.map(r => (
                            <div key={r.id} style={{ border: '1px solid var(--border-default)', padding: '16px', borderRadius: 'var(--radius-md)', background: 'var(--bg-card)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <h4 style={{ margin: 0 }}>{r.name}</h4>
                                    {r.is_default && <span style={{ fontSize: '12px', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', padding: '2px 6px', borderRadius: '4px' }}>Default</span>}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                                    {r.permissions.length} permissions • {r.included_roles?.length || 0} inherited roles
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '100px', overflowY: 'auto' }}>
                                    {r.permissions.map(p => (
                                        <span key={p} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-subtle)', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                            {permissions[p] || p}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Invite Modal */}
            {isInviteModalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: 'var(--bg-card)', padding: '24px', borderRadius: 'var(--radius-lg)', width: '400px', border: '1px solid var(--border-default)' }}>
                        <h3 style={{ margin: '0 0 16px 0' }}>Invite Member</h3>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Username or Email</label>
                            <input type="text" className="input" value={inviteInput} onChange={e => setInviteInput(e.target.value)} placeholder="user@example.com" style={{ width: '100%' }} />
                        </div>
                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Assign Roles</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {roles.map(r => (
                                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px' }}>
                                        <input type="checkbox" checked={selectedInviteRoles.includes(r.id)} onChange={e => {
                                            if (e.target.checked) setSelectedInviteRoles([...selectedInviteRoles, r.id]);
                                            else setSelectedInviteRoles(selectedInviteRoles.filter(id => id !== r.id));
                                        }} />
                                        {r.name}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button className="btn" onClick={() => setIsInviteModalOpen(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleInvite} disabled={!inviteInput || selectedInviteRoles.length === 0}>Send Invite</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Role Modal */}
            {isRoleModalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: 'var(--bg-card)', padding: '24px', borderRadius: 'var(--radius-lg)', width: '600px', maxHeight: '80vh', overflowY: 'auto', border: '1px solid var(--border-default)' }}>
                        <h3 style={{ margin: '0 0 16px 0' }}>Create Custom Role</h3>
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Role Name</label>
                            <input type="text" className="input" value={roleName} onChange={e => setRoleName(e.target.value)} placeholder="e.g. Audit Manager" style={{ width: '100%' }} />
                        </div>
                        
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Inherit from Roles (Max Depth 3)</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                                {roles.map(r => (
                                    <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', width: '45%' }}>
                                        <input type="checkbox" checked={selectedInheritedRoles.includes(r.id)} onChange={e => {
                                            if (e.target.checked) setSelectedInheritedRoles([...selectedInheritedRoles, r.id]);
                                            else setSelectedInheritedRoles(selectedInheritedRoles.filter(id => id !== r.id));
                                        }} />
                                        {r.name}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginBottom: '24px' }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Specific Permissions</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                                {Object.entries(permissions).map(([key, desc]) => (
                                    <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '13px', width: '45%', color: 'var(--text-secondary)' }}>
                                        <input type="checkbox" style={{ marginTop: '2px' }} checked={selectedPermissions.includes(key)} onChange={e => {
                                            if (e.target.checked) setSelectedPermissions([...selectedPermissions, key]);
                                            else setSelectedPermissions(selectedPermissions.filter(p => p !== key));
                                        }} />
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ color: 'var(--text-default)' }}>{desc}</span>
                                            <span style={{ fontSize: '10px', fontFamily: 'monospace', opacity: 0.7 }}>{key}</span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button className="btn" onClick={() => setIsRoleModalOpen(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleCreateRole} disabled={!roleName}>Create Role</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
