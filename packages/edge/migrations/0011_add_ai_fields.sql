
CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    rule_id TEXT,
    level TEXT,
    message TEXT,
    evidence TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE findings ADD COLUMN ai_status TEXT DEFAULT 'none';
ALTER TABLE findings ADD COLUMN ai_relevance TEXT;
ALTER TABLE findings ADD COLUMN ai_explanation TEXT;
ALTER TABLE findings ADD COLUMN ai_remediation TEXT;
ALTER TABLE findings ADD COLUMN ai_proposed_patch TEXT;
ALTER TABLE findings ADD COLUMN pr_link TEXT;


ALTER TABLE projects ADD COLUMN url_mappings TEXT;
ALTER TABLE projects ADD COLUMN ai_prompts TEXT;
ALTER TABLE projects ADD COLUMN propose_fixes INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN custom_cli_command TEXT;
