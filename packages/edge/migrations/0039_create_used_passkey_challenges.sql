-- WebAuthn login challenges that have been spent. KV deletes are neither atomic nor immediately
-- visible everywhere, so single use is enforced here: a challenge can be inserted once.
CREATE TABLE IF NOT EXISTS used_passkey_challenges (
    challenge TEXT PRIMARY KEY,
    used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
