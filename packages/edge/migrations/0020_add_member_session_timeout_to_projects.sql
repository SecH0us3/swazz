-- Migration: Add member_session_timeout setting to projects
ALTER TABLE projects ADD COLUMN member_session_timeout INTEGER DEFAULT 0;
