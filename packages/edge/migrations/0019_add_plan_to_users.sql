-- Migration: add plan to users table
ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'Free';
