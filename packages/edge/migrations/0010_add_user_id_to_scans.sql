-- Add user_id column to scans table to track ownership of standalone (project-less) scans.
-- In test environments the column already exists in the base table definition (0003_create_scans.sql).
-- The test migration runner is resilient to "duplicate column name" errors, so this is safe.
ALTER TABLE scans ADD COLUMN user_id TEXT;
