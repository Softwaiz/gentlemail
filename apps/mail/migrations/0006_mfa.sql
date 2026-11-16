-- Two-step verification (TOTP authenticator apps) with one-time recovery codes,
-- and app-wide settings (first one: whether every user must use two-step).

-- Base32 TOTP secret. Set when setup starts; two-step is on once mfa_enabled_at is set.
ALTER TABLE users ADD COLUMN mfa_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_enabled_at INTEGER;
-- Last accepted 30-second step, so the same code can't be used twice.
ALTER TABLE users ADD COLUMN mfa_last_step INTEGER;

-- Each code works once. Only a SHA-256 of the code is stored.
CREATE TABLE mfa_recovery_codes (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at   INTEGER,
  PRIMARY KEY (user_id, code_hash)
);

-- A sign-in waiting for its second step: the password was right, the code is still due.
CREATE TABLE login_challenges (
  id         TEXT PRIMARY KEY,                -- SHA-256 of the cookie value
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  next       TEXT NOT NULL DEFAULT '/',
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,                     -- 'require_mfa' = '1' when everyone must use two-step
  value TEXT NOT NULL
);
