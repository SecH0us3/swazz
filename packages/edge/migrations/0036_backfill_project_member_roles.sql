-- project_member_roles is now the only role source for authorization. Give any membership that
-- exists only in the legacy project_members table its role row, so it keeps access. Members that
-- already have role rows are left alone: their legacy column may hold a role they were demoted from.
INSERT OR IGNORE INTO project_member_roles (project_id, user_id, role_id)
SELECT pm.project_id, pm.user_id, pm.role
FROM project_members pm
WHERE NOT EXISTS (
  SELECT 1 FROM project_member_roles pmr
  WHERE pmr.project_id = pm.project_id AND pmr.user_id = pm.user_id
);
