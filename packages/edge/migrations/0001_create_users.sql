CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, -- ULID
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    public_key TEXT,
    retention_days INTEGER DEFAULT 90,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
