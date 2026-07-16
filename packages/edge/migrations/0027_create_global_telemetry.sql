CREATE TABLE IF NOT EXISTS global_telemetry (
    key TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0
);

INSERT INTO global_telemetry (key, value) VALUES ('total_scans', 0) ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS monthly_telemetry (
    yy_mm TEXT PRIMARY KEY,
    value INTEGER DEFAULT 0
);
