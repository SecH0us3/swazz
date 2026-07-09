-- Migration: Add secret column to project_webhooks
ALTER TABLE project_webhooks ADD COLUMN secret TEXT;
