-- API keys (send/read mail from other programs) and webhooks (push events out).

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,              -- first characters, shown in the UI
  key_hash     TEXT NOT NULL UNIQUE,       -- SHA-256 of the full key; the key itself is never stored
  mailbox_id   TEXT REFERENCES mailboxes(id) ON DELETE CASCADE, -- NULL = every mailbox
  scopes       TEXT NOT NULL DEFAULT 'send',                     -- comma list: send, read
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);

CREATE TABLE webhooks (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  secret     TEXT NOT NULL,                -- HMAC signing secret
  mailbox_id TEXT REFERENCES mailboxes(id) ON DELETE CASCADE, -- NULL = every mailbox
  events     TEXT NOT NULL DEFAULT 'message.received',        -- comma list
  active     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE webhook_deliveries (
  id              TEXT PRIMARY KEY,
  webhook_id      TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  message_id      TEXT,
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_status     INTEGER,
  last_error      TEXT,
  next_attempt_at INTEGER,
  created_at      INTEGER NOT NULL,
  delivered_at    INTEGER
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries(status, next_attempt_at);
CREATE INDEX webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at DESC);
