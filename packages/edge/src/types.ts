export interface Project {
  id: string;
  name: string;
  description: string;
  created_at?: string;
  url_mappings?: string;
  ai_prompts?: string;
  propose_fixes?: number;
  custom_cli_command?: string;
  auto_fix_rules?: string;
  member_session_timeout?: number;
}

export interface Finding {
  id: string;
  scan_id: string;
  rule_id?: string;
  level?: string;
  message?: string;
  evidence?: string;
  created_at?: string;
  ai_status?: string;
  ai_relevance?: string;
  ai_explanation?: string;
  ai_remediation?: string;
  ai_proposed_patch?: string;
  pr_link?: string;
}

export interface Webhook {
  id: string;
  project_id: string;
  url: string;
  headers?: string | null;
  event_types: string; // JSON array string
  secret: string;
  created_at?: string;
}

