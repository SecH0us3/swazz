-- The project's scan list (ScansRepository.getScans) pages newest first by (created_at, id); with
-- only scans(project_id) each page sorted every scan the project ever ran. The new index serves
-- every project_id lookup the old one did, so the old one goes.
CREATE INDEX IF NOT EXISTS idx_scans_project_created ON scans(project_id, created_at, id);
DROP INDEX IF EXISTS idx_scans_project_id;
