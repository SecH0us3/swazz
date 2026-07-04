export interface McpToolMetadata {
  name: string;
  description: string;
  path: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export const mcpTools: McpToolMetadata[] = [
  {
    name: 'swazz_list_projects',
    description: 'List all Swazz projects for the authenticated user.',
    path: '/api/projects',
    method: 'GET',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'swazz_list_scans',
    description: 'List scans for a specific project.',
    path: '/api/scans',
    method: 'GET',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project ID to get scans for'
        }
      },
      required: ['project_id']
    }
  },
  {
    name: 'swazz_get_scan_status',
    description: 'Get details and current status of a specific scan.',
    path: '/api/scans/:id',
    method: 'GET',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The scan ID'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'swazz_get_scan_findings',
    description: 'Get all vulnerability findings for a completed/running scan.',
    path: '/api/scans/:id/findings',
    method: 'GET',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The scan ID'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'swazz_trigger_scan',
    description: 'Trigger/queue a new Swazz scan for a project.',
    path: '/api/scans',
    method: 'POST',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project ID'
        },
        target_url: {
          type: 'string',
          description: 'The target URL to scan'
        },
        profile: {
          type: 'string',
          description: 'Fuzzing profile name (e.g., standard, fast, deep)'
        },
        config: {
          type: 'object',
          description: 'Optional additional CLI configuration overrides'
        }
      },
      required: ['project_id', 'target_url', 'profile']
    }
  }
];
