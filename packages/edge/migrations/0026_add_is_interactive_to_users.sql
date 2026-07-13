-- Migration to add is_interactive flag to users table.
-- If 0, the user is a service account and cannot login interactively.
ALTER TABLE users ADD COLUMN is_interactive INTEGER DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_users_is_interactive ON users(is_interactive);
