-- Alter users table to add email column
ALTER TABLE users ADD COLUMN email TEXT;

-- Table for tracking rate limits
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    attempts INTEGER DEFAULT 0,
    reset_at DATETIME NOT NULL
);

-- Table for temporary login flow states and Proof of Work challenges
CREATE TABLE IF NOT EXISTS login_challenges (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    challenge TEXT NOT NULL,
    difficulty INTEGER NOT NULL,
    expires_at DATETIME NOT NULL
);

-- Table for passwordless magic link login tokens
CREATE TABLE IF NOT EXISTS magic_links (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    client_ip TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0
);
