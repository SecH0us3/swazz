-- Migration: Add license_key to users table for feature gating (Task #590)
ALTER TABLE users ADD COLUMN license_key TEXT;
