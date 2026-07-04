-- Migration: add cron_schedule and last_run_at to scan_configs table
ALTER TABLE scan_configs ADD COLUMN cron_schedule TEXT;
ALTER TABLE scan_configs ADD COLUMN last_run_at DATETIME;
