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
        <div className="card rbac-tab-container">
            <div className="rbac-tab-header">
                <h3 className="rbac-tab-title">Access & Permissions</h3>
                <div className="rbac-tab-switcher">
                    <button 
                        onClick={() => setView('members')}
                        className={`rbac-tab-btn ${view === 'members' ? 'active' : ''}`}
                    >Members</button>
                    <button 
                        onClick={() => setView('roles')}
                        className={`rbac-tab-btn ${view === 'roles' ? 'active' : ''}`}
                    >Roles</button>
                </div>
            </div>

            {view === 'members' && (
                <>
                    <div className="rbac-action-bar">
                        <button className="btn btn-primary" onClick={() => setIsInviteModalOpen(true)}>Invite User</button>
                    </div>
                    <table className="rbac-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Roles</th>
                            </tr>
                        </thead>
                        <tbody>
                            {members.map(m => (
                                <tr key={m.id}>
                                    <td>{m.username || m.email}</td>
                                    <td>
                                        {m.roles.map(rid => {
                                            const role = roles.find(r => r.id === rid);
                                            return <span key={rid} className="rbac-role-badge">{role?.name || rid}</span>;
                                        })}
                                    </td>
                                </tr>
                            ))}
                            {members.length === 0 && (
                                <tr>
                                    <td colSpan={2} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No members found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </>
            )}

            {view === 'roles' && (
                <>
                    <div className="rbac-action-bar">
                        <button className="btn btn-primary" onClick={() => setIsRoleModalOpen(true)}>Create Custom Role</button>
                    </div>
                    <div className="rbac-roles-grid">
                        {roles.map(r => (
                            <div key={r.id} className="rbac-role-card">
                                <div className="rbac-role-card-header">
                                    <h4 className="rbac-role-card-title">{r.name}</h4>
                                    {r.is_default && <span className="rbac-role-default-badge">Default</span>}
                                </div>
                                <div className="rbac-role-stats">
                                    {r.permissions.length} permissions
                                    {r.included_roles && r.included_roles.length > 0 && ` • Includes ${r.included_roles.length} roles`}
                                </div>
                                <div className="rbac-permissions-list">
                                    {r.permissions.map(p => (
                                        <span key={p} className="rbac-permission-pill">{p.split(':')[1] || p}</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Invite Modal */}
            {isInviteModalOpen && (
                <div className="modal-overlay">
                    <div className="rbac-modal-content invite-modal">
                        <h3 className="rbac-tab-title" style={{ marginBottom: '16px' }}>Invite User</h3>
                        
                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Email or Username</label>
                            <input 
                                type="text" 
                                className="input" 
                                value={inviteInput} 
                                onChange={e => setInviteInput(e.target.value)} 
                                placeholder="user@example.com"
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Roles to Assign</label>
                            <div className="rbac-checkbox-grid" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                {roles.map(r => (
                                    <label key={r.id} className="rbac-checkbox-item">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedInviteRoles.includes(r.id)}
                                            onChange={e => {
                                                if (e.target.checked) setSelectedInviteRoles([...selectedInviteRoles, r.id]);
                                                else setSelectedInviteRoles(selectedInviteRoles.filter(id => id !== r.id));
                                            }}
                                        />
                                        <span>{r.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="rbac-modal-footer">
                            <button className="btn btn-secondary" onClick={() => setIsInviteModalOpen(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleInvite} disabled={!inviteInput || selectedInviteRoles.length === 0}>Send Invite</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Custom Role Modal */}
            {isRoleModalOpen && (
                <div className="modal-overlay">
                    <div className="rbac-modal-content">
                        <h3 className="rbac-tab-title" style={{ marginBottom: '16px' }}>Create Custom Role</h3>
                        
                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Role Name</label>
                            <input 
                                type="text" 
                                className="input" 
                                value={roleName} 
                                onChange={e => setRoleName(e.target.value)} 
                                placeholder="e.g. Audit Viewer"
                                style={{ width: '100%' }}
                            />
                        </div>

                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Inherit from existing roles (Optional)</label>
                            <div className="rbac-checkbox-grid">
                                {roles.map(r => (
                                    <label key={r.id} className="rbac-checkbox-item">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedInheritedRoles.includes(r.id)}
                                            onChange={e => {
                                                if (e.target.checked) setSelectedInheritedRoles([...selectedInheritedRoles, r.id]);
                                                else setSelectedInheritedRoles(selectedInheritedRoles.filter(id => id !== r.id));
                                            }}
                                        />
                                        <span>{r.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Assign Permissions</label>
                            <div className="rbac-checkbox-grid">
                                {Object.entries(permissions).map(([key, desc]) => (
                                    <label key={key} className="rbac-checkbox-item">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedPermissions.includes(key)}
                                            onChange={e => {
                                                if (e.target.checked) setSelectedPermissions([...selectedPermissions, key]);
                                                else setSelectedPermissions(selectedPermissions.filter(k => k !== key));
                                            }}
                                        />
                                        <div className="rbac-checkbox-item-desc">
                                            <strong>{desc}</strong>
                                            <code>{key}</code>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="rbac-modal-footer">
                            <button className="btn btn-secondary" onClick={() => setIsRoleModalOpen(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleCreateRole} disabled={!roleName || (selectedPermissions.length === 0 && selectedInheritedRoles.length === 0)}>Create Role</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
