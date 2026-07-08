-- Migration: Create project webhooks table
CREATE TABLE IF NOT EXISTS project_webhooks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    url TEXT NOT NULL,
    headers TEXT, -- JSON string representing custom key-value headers
    event_types TEXT NOT NULL, -- JSON array of string event types: ["scan.started", "scan.completed", "scan.failed", "finding.created", "finding.triaged"]
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_webhooks_project_id ON project_webhooks(project_id);
