CREATE TABLE IF NOT EXISTS project_custom_roles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS custom_role_permissions (
    role_id TEXT NOT NULL,
    permission_key TEXT NOT NULL,
    PRIMARY KEY(role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS custom_role_inheritance (
    parent_role_id TEXT NOT NULL,
    child_role_id TEXT NOT NULL,
    PRIMARY KEY(parent_role_id, child_role_id)
);

CREATE TABLE IF NOT EXISTS project_member_roles (
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    PRIMARY KEY(project_id, user_id, role_id)
);

-- Migrate existing roles from project_members to project_member_roles
INSERT OR IGNORE INTO project_member_roles (project_id, user_id, role_id)
SELECT project_id, user_id, role FROM project_members;

CREATE TABLE IF NOT EXISTS project_invitations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    email TEXT,
    username TEXT,
    target_role_ids TEXT NOT NULL, -- JSON array of role_ids
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Expired', 'Revoked')),
    token TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    CHECK (email IS NOT NULL OR username IS NOT NULL),
    CHECK (json_valid(target_role_ids) AND json_array_length(target_role_ids) > 0)
);

CREATE INDEX IF NOT EXISTS idx_invitations_token ON project_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_project ON project_invitations(project_id);
