-- Last TOTP time step accepted for the user. A code whose step is not newer is refused, so an
-- observed one-time code cannot be replayed within its acceptance window (RFC 6238 section 5.2).
ALTER TABLE users ADD COLUMN two_factor_last_counter INTEGER DEFAULT NULL;
