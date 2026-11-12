-- Webmail: initial schema

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE, -- login identifier
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,           -- SHA-256 of the cookie token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE mailboxes (
  id           TEXT PRIMARY KEY,
  address      TEXT NOT NULL UNIQUE COLLATE NOCASE, -- e.g. hello@example.com
  display_name TEXT NOT NULL,
  signature    TEXT NOT NULL DEFAULT '',            -- plain text, appended to outgoing mail
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

CREATE TABLE mailbox_members (
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (mailbox_id, user_id)
);
CREATE INDEX mailbox_members_user ON mailbox_members(user_id);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  mailbox_id      TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  thread_id       TEXT NOT NULL,
  folder          TEXT NOT NULL CHECK (folder IN ('inbox', 'sent', 'archive', 'trash', 'spam')),
  direction       TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  message_id      TEXT,                 -- RFC 5322 Message-ID, without <>
  in_reply_to     TEXT,
  references_hdr  TEXT,
  from_addr       TEXT NOT NULL,
  from_name       TEXT NOT NULL DEFAULT '',
  to_json         TEXT NOT NULL DEFAULT '[]',  -- [{name, address}]
  cc_json         TEXT NOT NULL DEFAULT '[]',
  bcc_json        TEXT NOT NULL DEFAULT '[]',
  reply_to        TEXT,
  subject         TEXT NOT NULL DEFAULT '',
  snippet         TEXT NOT NULL DEFAULT '',
  text_body       TEXT,
  html_body       TEXT,
  html_key        TEXT,                 -- R2 key when HTML is too large for D1
  raw_key         TEXT,                 -- R2 key of the raw .eml (inbound)
  size            INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  is_read         INTEGER NOT NULL DEFAULT 0,
  is_starred      INTEGER NOT NULL DEFAULT 0,
  date            INTEGER NOT NULL,     -- ms since epoch (sent / received)
  created_at      INTEGER NOT NULL
);
CREATE INDEX messages_folder ON messages(mailbox_id, folder, date DESC);
CREATE INDEX messages_thread ON messages(thread_id, date);
CREATE INDEX messages_msgid ON messages(mailbox_id, message_id);

CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  r2_key       TEXT NOT NULL,
  content_id   TEXT,                    -- for inline (cid:) images
  disposition  TEXT NOT NULL DEFAULT 'attachment',
  created_at   INTEGER NOT NULL
);
CREATE INDEX attachments_message ON attachments(message_id);
