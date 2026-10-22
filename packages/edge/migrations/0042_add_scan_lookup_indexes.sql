-- Indexes for lookups that read their whole table.
--  - findings(scan_id): a scan's findings (ScansRepository.getFindings, behind the report and the
--    findings list) and the per-project charts that join findings to the project's scans
--    (ProjectsRepository.getProjectAnalytics). Without it each one read every finding ever stored.
--  - scans(status, created_at): the stalled scan watchdog (hasActiveScans, getStalledActiveScans)
--    and the queued/active scan lists (getQueuedScans, getActiveScans), which run on every dispatch
--    and resume pass. Without it each pass read every scan ever run; created_at also gives the
--    single-status list its order without a sort.
CREATE INDEX IF NOT EXISTS idx_findings_scan_id ON findings(scan_id);
CREATE INDEX IF NOT EXISTS idx_scans_status_created ON scans(status, created_at);
