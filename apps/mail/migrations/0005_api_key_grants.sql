-- Granular API key access: a key holds any number of grants, each with its own
-- read / send permission, on every mailbox, a whole domain (including mailboxes
-- added to it later) or one mailbox. A key can use a mailbox when any of its
-- grants covers it. api_keys.mailbox_id and api_keys.scopes are no longer read.

CREATE TABLE api_key_grants (
  key_id      TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('all', 'domain', 'mailbox')),
  target_id   TEXT NOT NULL DEFAULT '',  -- domains.id or mailboxes.id; '' for 'all'
  can_read    INTEGER NOT NULL DEFAULT 0,
  can_send    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, target_type, target_id)
);
CREATE INDEX api_key_grants_target ON api_key_grants(target_type, target_id);

-- Existing keys keep exactly the access they had.
INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_send)
SELECT id,
       CASE WHEN mailbox_id IS NULL THEN 'all' ELSE 'mailbox' END,
       COALESCE(mailbox_id, ''),
       instr(scopes, 'read') > 0,
       instr(scopes, 'send') > 0
FROM api_keys;
