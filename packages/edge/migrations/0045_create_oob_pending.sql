-- OOB tokens a run was still waiting on when it ended. The runner hands them over before its end
-- event; a target that calls back later (a queued job, a crawler, a mail filter) is then still
-- reported, as a finding of that scan. A row is deleted when its callback arrives, so one token
-- gives at most one finding, and is dropped 7 days after the scan.
CREATE TABLE IF NOT EXISTS oob_pending (
    scan_id TEXT NOT NULL,
    token TEXT NOT NULL,
    endpoint TEXT,
    payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scan_id, token)
);

CREATE INDEX IF NOT EXISTS idx_oob_pending_created_at ON oob_pending(created_at);
