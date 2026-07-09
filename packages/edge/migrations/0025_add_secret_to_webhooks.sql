-- Migration: Add secret column to project_webhooks
ALTER TABLE project_webhooks ADD COLUMN secret TEXT;
UPDATE project_webhooks SET secret = 'whsec_' || hex(randomblob(24)) WHERE secret IS NULL;
