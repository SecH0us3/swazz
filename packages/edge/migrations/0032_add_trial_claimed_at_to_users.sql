-- Migration: Add trial_claimed_at to users table for one-time trial license tracking (Issue #607)
ALTER TABLE users ADD COLUMN trial_claimed_at DATETIME;
