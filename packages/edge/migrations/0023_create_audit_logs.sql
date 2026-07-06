-- Migration: Create audit_logs table
-- Tracks state-changing user actions within projects for compliance and governance.
-- actor_username is denormalised (snapshot) so records survive user deletion.
-- user_id intentionally has NO FK ON DELETE CASCADE — rows must outlive user accounts.
CREATE TABLE audit_logs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  user_id        TEXT,
  actor_username TEXT,
  actor_role     TEXT,
  action         TEXT NOT NULL,
  action_label   TEXT,
  source         TEXT NOT NULL DEFAULT 'web',
  details        TEXT,
  ip_address     TEXT,
  timestamp      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_audit_logs_project_ts ON audit_logs(project_id, timestamp DESC);
CREATE INDEX idx_audit_logs_user       ON audit_logs(user_id);
