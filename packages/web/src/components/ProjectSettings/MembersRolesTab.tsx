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
    is_pending?: boolean;
}

export function MembersRolesTab() {
    const activeProject = useAppStore(state => state.activeProject);
    const userProfile = useAppStore(state => state.userProfile);
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
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [roleName, setRoleName] = useState('');
    const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
    const [selectedInheritedRoles, setSelectedInheritedRoles] = useState<string[]>([]);
    const [permissionSearch, setPermissionSearch] = useState('');

    // Edit Member State
    const [editingMember, setEditingMember] = useState<Member | null>(null);
    const [selectedMemberRoles, setSelectedMemberRoles] = useState<string[]>([]);

    useEffect(() => {
        if (!activeProject) return;
        fetchPermissions();
        fetchRoles();
        fetchMembers();
    }, [activeProject]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isInviteModalOpen) {
                    setIsInviteModalOpen(false);
                    setInviteInput('');
                    setSelectedInviteRoles([]);
                    e.stopPropagation();
                    e.preventDefault();
                } else if (isRoleModalOpen) {
                    handleCloseRoleModal();
                    e.stopPropagation();
                    e.preventDefault();
                } else if (editingMember) {
                    setEditingMember(null);
                    e.stopPropagation();
                    e.preventDefault();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isInviteModalOpen, isRoleModalOpen, editingMember]);

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
            fetchMembers();
            showToast('Invitation sent successfully', 'success');
        } else {
            showToast('Failed to send invitation', 'error');
        }
    };

    const handleOpenEditRoleModal = (r: Role) => {
        setEditingRole(r);
        setRoleName(r.name);
        setSelectedPermissions(r.permissions);
        setSelectedInheritedRoles(r.included_roles || []);
        setIsRoleModalOpen(true);
    };

    const handleCloseRoleModal = () => {
        setIsRoleModalOpen(false);
        setEditingRole(null);
        setRoleName('');
        setSelectedPermissions([]);
        setSelectedInheritedRoles([]);
        setPermissionSearch('');
    };

    const handleSaveRole = async () => {
        const url = editingRole 
            ? `/api/projects/${activeProject?.id}/roles/${editingRole.id}`
            : `/api/projects/${activeProject?.id}/roles`;
        const method = editingRole ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: getHeaders(),
            body: JSON.stringify({
                name: roleName,
                permissions: selectedPermissions,
                included_roles: selectedInheritedRoles
            })
        });

        if (res.ok) {
            handleCloseRoleModal();
            fetchRoles();
            showToast(editingRole ? 'Custom role updated successfully' : 'Custom role created successfully', 'success');
        } else {
            showToast(editingRole ? 'Failed to update custom role' : 'Failed to create custom role', 'error');
        }
    };

    const handleDeleteCustomRole = async (roleId: string) => {
        if (!confirm('Are you sure you want to delete this custom role? This will also remove it from any members.')) return;
        const res = await fetch(`/api/projects/${activeProject?.id}/roles/${roleId}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        if (res.ok) {
            fetchRoles();
            fetchMembers();
            showToast('Custom role deleted successfully', 'success');
        } else {
            showToast('Failed to delete custom role', 'error');
        }
    };

    const handleOpenEditMemberModal = (m: Member) => {
        setEditingMember(m);
        setSelectedMemberRoles(m.roles);
    };

    const handleSaveMemberRoles = async () => {
        if (!editingMember) return;
        const res = await fetch(`/api/projects/${activeProject?.id}/members/${editingMember.id}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({ roles: selectedMemberRoles })
        });
        if (res.ok) {
            setEditingMember(null);
            fetchMembers();
            showToast('Member roles updated successfully', 'success');
        } else {
            showToast('Failed to update member roles', 'error');
        }
    };

    const handleRemoveMember = async (memberId: string) => {
        if (!confirm('Are you sure you want to remove this member / invitation?')) return;
        const res = await fetch(`/api/projects/${activeProject?.id}/members/${memberId}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        if (res.ok) {
            fetchMembers();
            showToast('Member/Invitation removed successfully', 'success');
        } else {
            showToast('Failed to remove member/invitation', 'error');
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
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {members.map(m => (
                                <tr key={m.id}>
                                    <td>
                                        {m.username || m.email}
                                        {m.is_pending && <span className="rbac-pending-badge">Invited</span>}
                                    </td>
                                    <td>
                                        {m.roles.map(rid => {
                                            const role = roles.find(r => r.id === rid);
                                            return <span key={rid} className="rbac-role-badge">{role?.name || rid}</span>;
                                        })}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                            {m.id !== userProfile?.id && (
                                                <>
                                                    <button className="btn btn-ghost btn-sm" onClick={() => handleOpenEditMemberModal(m)}>Edit Roles</button>
                                                    <button className="btn btn-danger btn-sm" onClick={() => handleRemoveMember(m.id)}>Remove</button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {members.length === 0 && (
                                <tr>
                                    <td colSpan={3} className="rbac-empty-state">No members found.</td>
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
                                    {r.is_default ? (
                                        <span className="rbac-role-default-badge">Default</span>
                                    ) : (
                                        <div style={{ display: 'flex', gap: '6px' }}>
                                            <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', height: '24px', fontSize: '11px' }} onClick={() => handleOpenEditRoleModal(r)}>Edit</button>
                                            <button className="btn btn-danger btn-sm" style={{ padding: '2px 8px', height: '24px', fontSize: '11px' }} onClick={() => handleDeleteCustomRole(r.id)}>Delete</button>
                                        </div>
                                    )}
                                </div>
                                <div className="rbac-role-stats">
                                    {r.permissions.length} permissions
                                    {r.included_roles && r.included_roles.length > 0 && ` • Includes ${r.included_roles.length} roles`}
                                </div>
                                <div className="rbac-permissions-list">
                                    {r.permissions.map(p => {
                                        let pillClass = 'rbac-permission-pill-view';
                                        if (p.startsWith('delete:')) pillClass = 'rbac-permission-pill-delete';
                                        else if (p.startsWith('post:') || p.startsWith('put:') || p.startsWith('patch:')) pillClass = 'rbac-permission-pill-edit';
                                        return (
                                            <span key={p} className={`rbac-permission-pill ${pillClass}`} title={p}>
                                                {permissions[p] || p}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Invite Modal */}
            {isInviteModalOpen && (
                <div className="modal-container">
                    <div className="rbac-modal-content invite-modal">
                        <h3 className="rbac-tab-title rbac-modal-title">Invite User</h3>
                        
                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Email or Username</label>
                            <input 
                                type="text" 
                                className="input rbac-input-full" 
                                value={inviteInput} 
                                onChange={e => setInviteInput(e.target.value)} 
                                placeholder="user@example.com"
                            />
                        </div>

                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Roles to Assign</label>
                            <div className="rbac-checkbox-grid rbac-checkbox-grid-scroll">
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

            {/* Create / Edit Custom Role Modal */}
            {isRoleModalOpen && (
                <div className="modal-container">
                    <div className="rbac-modal-content">
                        <h3 className="rbac-tab-title rbac-modal-title">{editingRole ? 'Edit Custom Role' : 'Create Custom Role'}</h3>
                        
                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Role Name</label>
                            <input 
                                type="text" 
                                className="input rbac-input-full" 
                                value={roleName} 
                                onChange={e => setRoleName(e.target.value)} 
                                placeholder="e.g. Audit Viewer"
                            />
                        </div>

                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Inherit from existing roles (Optional)</label>
                            <div className="rbac-checkbox-grid">
                                {roles.filter(r => !editingRole || r.id !== editingRole.id).map(r => (
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <label className="rbac-form-label" style={{ margin: 0 }}>Assign Permissions</label>
                                <input 
                                    type="text" 
                                    className="input" 
                                    style={{ width: '220px', height: '28px', fontSize: '12px', padding: '4px 8px' }}
                                    placeholder="Search permissions..."
                                    value={permissionSearch}
                                    onChange={e => setPermissionSearch(e.target.value)}
                                />
                            </div>
                            <div className="rbac-permissions-checkbox-grid">
                                {Object.entries(permissions)
                                    .filter(([key, desc]) => 
                                        desc.toLowerCase().includes(permissionSearch.toLowerCase()) || 
                                        key.toLowerCase().includes(permissionSearch.toLowerCase())
                                    )
                                    .map(([key, desc]) => (
                                        <label key={key} className="rbac-permissions-checkbox-item">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedPermissions.includes(key)}
                                                onChange={e => {
                                                    if (e.target.checked) setSelectedPermissions([...selectedPermissions, key]);
                                                    else setSelectedPermissions(selectedPermissions.filter(k => k !== key));
                                                }}
                                            />
                                            <div className="rbac-permissions-checkbox-desc">
                                                <strong>{desc}</strong>
                                                <code className={
                                                    key.startsWith('delete:') ? 'rbac-code-delete' :
                                                    (key.startsWith('post:') || key.startsWith('put:') || key.startsWith('patch:')) ? 'rbac-code-edit' :
                                                    'rbac-code-view'
                                                }>{key}</code>
                                            </div>
                                        </label>
                                    ))
                                }
                                {Object.entries(permissions).filter(([key, desc]) => 
                                    desc.toLowerCase().includes(permissionSearch.toLowerCase()) || 
                                    key.toLowerCase().includes(permissionSearch.toLowerCase())
                                ).length === 0 && (
                                    <div className="rbac-empty-state" style={{ padding: '20px 0' }}>No matching permissions found.</div>
                                )}
                            </div>
                        </div>

                        <div className="rbac-modal-footer">
                            <button className="btn btn-secondary" onClick={handleCloseRoleModal}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSaveRole} disabled={!roleName || (selectedPermissions.length === 0 && selectedInheritedRoles.length === 0)}>
                                {editingRole ? 'Save Changes' : 'Create Role'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Member Roles Modal */}
            {editingMember && (
                <div className="modal-container">
                    <div className="rbac-modal-content invite-modal">
                        <h3 className="rbac-tab-title rbac-modal-title">Edit Roles for {editingMember.username || editingMember.email}</h3>

                        <div className="rbac-form-group">
                            <label className="rbac-form-label">Select Roles</label>
                            <div className="rbac-checkbox-grid rbac-checkbox-grid-scroll">
                                {roles.map(r => (
                                    <label key={r.id} className="rbac-checkbox-item">
                                        <input 
                                            type="checkbox" 
                                            checked={selectedMemberRoles.includes(r.id)}
                                            onChange={e => {
                                                if (e.target.checked) setSelectedMemberRoles([...selectedMemberRoles, r.id]);
                                                else setSelectedMemberRoles(selectedMemberRoles.filter(id => id !== r.id));
                                            }}
                                        />
                                        <span>{r.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="rbac-modal-footer">
                            <button className="btn btn-secondary" onClick={() => setEditingMember(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSaveMemberRoles} disabled={selectedMemberRoles.length === 0}>Save Changes</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
