-- One-time tickets that open the live event stream of a scan. Browsers cannot set headers on a
-- WebSocket, so the dashboard used to put its session JWT in the URL, where proxy and
-- Cloudflare logs keep it. A ticket is bound to one user and one run, lives 30 seconds, and is
-- deleted when it is used. Only the SHA-256 hash of a ticket is stored.
CREATE TABLE IF NOT EXISTS ws_tickets (
    ticket_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ws_tickets_expires_at ON ws_tickets(expires_at);

-- Each issue counts and prunes the live tickets of one user.
CREATE INDEX IF NOT EXISTS idx_ws_tickets_user ON ws_tickets(user_id, expires_at);
