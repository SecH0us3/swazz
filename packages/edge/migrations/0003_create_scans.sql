CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    target_url TEXT NOT NULL,
    profile TEXT NOT NULL,
    status TEXT NOT NULL,
    summary_stats TEXT,
    report_url TEXT,
    is_encrypted BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_scans_project_id ON scans(project_id);

