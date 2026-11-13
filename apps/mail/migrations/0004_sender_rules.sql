-- Per-mailbox sender lists, learned from "Spam" / "Not spam".
-- sender is a full address (jane@example.com) or a whole domain (@example.com).
CREATE TABLE sender_rules (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  sender TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('block', 'allow')),
  created_at INTEGER NOT NULL,
  UNIQUE (mailbox_id, sender)
);

-- Why a message went to spam (shown in the conversation), null when it didn't.
ALTER TABLE messages ADD COLUMN spam_reason TEXT;
