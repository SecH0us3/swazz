-- Migration: Add plan column to users table
ALTER TABLE users ADD COLUMN plan TEXT DEFAULT 'Free';
