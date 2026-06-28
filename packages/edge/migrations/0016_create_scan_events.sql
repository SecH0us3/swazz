CREATE TABLE IF NOT EXISTS scan_events (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scan_events_scan_id ON scan_events(scan_id);
