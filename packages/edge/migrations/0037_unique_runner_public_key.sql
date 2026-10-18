-- A runner that connects with a public key is attributed to the account holding that key, so a
-- key may belong to one account only. Keys were stored without proof of possession or a
-- uniqueness check; any key held by more than one account is cleared (its owner must register it
-- again) because there is no way to tell which holder is legitimate.
UPDATE users SET public_key = NULL WHERE public_key = '';
UPDATE users SET public_key = lower(public_key) WHERE public_key IS NOT NULL;
UPDATE users SET public_key = NULL WHERE public_key IN (
  SELECT public_key FROM users WHERE public_key IS NOT NULL GROUP BY public_key HAVING COUNT(*) > 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_key_unique ON users(public_key) WHERE public_key IS NOT NULL;
