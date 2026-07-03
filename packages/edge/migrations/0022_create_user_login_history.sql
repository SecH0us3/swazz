-- Migration: Create user_login_history table
CREATE TABLE user_login_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    country TEXT,
    city TEXT,
    region TEXT,
    timezone TEXT,
    cf_ray TEXT,
    user_agent TEXT,
    auth_method TEXT NOT NULL DEFAULT 'password',
    two_factor_active INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_login_history_user_created ON user_login_history(user_id, created_at DESC);
