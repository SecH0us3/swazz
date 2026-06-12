CREATE TABLE IF NOT EXISTS swagger_cache (
    url TEXT PRIMARY KEY,
    base_path TEXT NOT NULL,
    endpoints_hash TEXT NOT NULL,
    endpoints_r2_key TEXT NOT NULL,
    raw_spec_r2_key TEXT NOT NULL,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
