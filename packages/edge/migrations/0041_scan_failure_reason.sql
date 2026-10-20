-- Why a scan failed, as shown to the user: written when the scan's status becomes 'failed', so a
-- scan listing does not search the scan's events for it.
ALTER TABLE scans ADD COLUMN failure_reason TEXT;

-- The stalled scan watchdog looks up each active scan's latest event every minute.
CREATE INDEX IF NOT EXISTS idx_scan_events_scan_created ON scan_events(scan_id, created_at);
