export const PERMISSIONS = {
  'get:/api/projects/:id': 'View project details',
  'patch:/api/projects/:id': 'Edit project settings',
  'delete:/api/projects/:id': 'Delete project',
  'get:/api/projects/:id/config': 'View scan configuration',
  'post:/api/projects/:id/config': 'Edit scan configuration',
  'get:/api/projects/:id/members': 'View project members',
  'post:/api/projects/:id/invitations': 'Invite new members',
  'delete:/api/projects/:id/members/:user_id': 'Remove project members',
  'put:/api/projects/:id/members/:user_id': 'Edit member roles',
  'get:/api/projects/:id/roles': 'View project roles',
  'post:/api/projects/:id/roles': 'Create custom roles',
  'put:/api/projects/:id/roles/:role_id': 'Edit custom roles',
  'delete:/api/projects/:id/roles/:role_id': 'Delete custom roles',
  'post:/api/projects/:id/scans': 'Start new scans',
  'get:/api/projects/:id/scans': 'View scan history',
  'post:/api/projects/:id/schedule': 'Configure scan schedule',
  'get:/api/projects/:id/members/:user_id/login-history': 'View member login history',
  'get:/api/projects/:id/audit-logs': 'View project audit trail',
};

export type PermissionKey = keyof typeof PERMISSIONS;

export const DEFAULT_ROLES: Record<string, { name: string; permissions: PermissionKey[] }> = {
  'owner': {
    name: 'Owner',
    permissions: Object.keys(PERMISSIONS) as PermissionKey[]
  },
  'editor': {
    name: 'Editor',
    permissions: [
      'get:/api/projects/:id',
      'patch:/api/projects/:id',
      'get:/api/projects/:id/config',
      'post:/api/projects/:id/config',
      'post:/api/projects/:id/schedule',
      'get:/api/projects/:id/members',
      'post:/api/projects/:id/invitations',
      'delete:/api/projects/:id/members/:user_id',
      'put:/api/projects/:id/members/:user_id',
      'get:/api/projects/:id/roles',
      'post:/api/projects/:id/roles',
      'put:/api/projects/:id/roles/:role_id',
      'delete:/api/projects/:id/roles/:role_id',
      'post:/api/projects/:id/scans',
      'get:/api/projects/:id/scans',
      'get:/api/projects/:id/members/:user_id/login-history',
      'get:/api/projects/:id/audit-logs'
    ]
  },
  'viewer': {
    name: 'Viewer',
    permissions: [
      'get:/api/projects/:id',
      'get:/api/projects/:id/config',
      'get:/api/projects/:id/members',
      'get:/api/projects/:id/roles',
      'get:/api/projects/:id/scans'
    ]
  }
};
