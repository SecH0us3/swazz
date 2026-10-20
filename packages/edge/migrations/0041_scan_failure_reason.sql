-- Why a scan failed, as shown to the user: written when the scan's status becomes 'failed', so a
-- scan listing does not search the scan's events for it.
ALTER TABLE scans ADD COLUMN failure_reason TEXT;

-- When the scan's status last changed (dispatched, paused, resumed): the stalled scan watchdog
-- counts idle time from it, so a scan that waited long in the queue is not stalled on dispatch.
ALTER TABLE scans ADD COLUMN status_changed_at DATETIME;

-- The stalled scan watchdog looks up each active scan's latest event every minute.
CREATE INDEX IF NOT EXISTS idx_scan_events_scan_created ON scan_events(scan_id, created_at);
