-- AI assistants connected by signing in (OAuth 2.1, for the MCP endpoint).
--
-- A connection is a row in api_keys with user_id set: it has grants like any key,
-- but it acts for that person, never reaches more than the mailboxes they can open,
-- and goes when they are deleted. Its key_hash is a placeholder no key can match;
-- it is used with short-lived tokens instead.

ALTER TABLE api_keys ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD COLUMN client_id TEXT;
CREATE INDEX api_keys_user ON api_keys(user_id);

-- Apps that registered themselves (Dynamic Client Registration, RFC 7591).
CREATE TABLE oauth_clients (
  id            TEXT PRIMARY KEY,           -- client_id
  name          TEXT NOT NULL,              -- as the app calls itself; shown on the consent screen
  redirect_uris TEXT NOT NULL,              -- JSON array
  secret_hash   TEXT,                       -- SHA-256 of client_secret; NULL = public client (PKCE only)
  created_at    INTEGER NOT NULL
);

-- Authorization codes: single use, a few minutes. The connection is made when one is exchanged.
CREATE TABLE oauth_codes (
  id             TEXT PRIMARY KEY,          -- SHA-256 of the code
  client_id      TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,             -- PKCE, S256
  grants         TEXT NOT NULL,             -- JSON: what the person allowed
  expires_at     INTEGER NOT NULL
);

-- Access tokens (an hour) and refresh tokens (rotated on each use).
CREATE TABLE oauth_tokens (
  id         TEXT PRIMARY KEY,              -- SHA-256 of the token
  key_id     TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX oauth_tokens_key ON oauth_tokens(key_id);
CREATE INDEX oauth_tokens_expiry ON oauth_tokens(expires_at);
