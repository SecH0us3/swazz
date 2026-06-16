CREATE TABLE IF NOT EXISTS runners (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    is_shared BOOLEAN DEFAULT 0,
    status TEXT NOT NULL,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_runners_user_id ON runners(user_id);
