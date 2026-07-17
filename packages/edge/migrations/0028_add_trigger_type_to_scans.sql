-- Migration: add trigger_type to scans table
ALTER TABLE scans ADD COLUMN trigger_type TEXT DEFAULT 'manual';
