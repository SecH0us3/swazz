-- Migration: Add ai_confidence to findings table
ALTER TABLE findings ADD COLUMN ai_confidence INTEGER;
