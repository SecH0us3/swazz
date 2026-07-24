-- Migration: Add gitlab_id to users
ALTER TABLE users ADD COLUMN gitlab_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_gitlab_id ON users (gitlab_id) WHERE gitlab_id IS NOT NULL;
