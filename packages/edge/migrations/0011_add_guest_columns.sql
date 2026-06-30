-- Add guest fields to users table to support temporary auto-deleted guest accounts.
ALTER TABLE users ADD COLUMN is_guest INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN expires_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_users_is_guest ON users(is_guest);
