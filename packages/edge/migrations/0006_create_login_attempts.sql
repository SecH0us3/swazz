CREATE TABLE IF NOT EXISTS login_attempts (
    email TEXT PRIMARY KEY,
    failed_count INTEGER DEFAULT 0,
    locked_until DATETIME
);
