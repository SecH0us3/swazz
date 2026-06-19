-- Add user_id column to scans table to track ownership of standalone (project-less) scans.
ALTER TABLE scans ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);
