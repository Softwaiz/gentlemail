-- Shared instance: domains are managed in the admin UI instead of a config var.

CREATE TABLE domains (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE, -- e.g. example.com
  active     INTEGER NOT NULL DEFAULT 1,          -- 0 = rejects inbound, blocks sending
  created_at INTEGER NOT NULL
);

-- Register every domain already used by an existing mailbox.
INSERT INTO domains (id, name, active, created_at)
SELECT lower(hex(randomblob(16))), d, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM (SELECT DISTINCT lower(substr(address, instr(address, '@') + 1)) AS d FROM mailboxes);
