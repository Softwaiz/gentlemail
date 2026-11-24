-- Formatted signatures with a logo. mailboxes.signature stays, as the plain-text version.
ALTER TABLE mailboxes ADD COLUMN signature_html TEXT NOT NULL DEFAULT '';      -- cleaned HTML; empty: shown from the text
ALTER TABLE mailboxes ADD COLUMN signature_line INTEGER NOT NULL DEFAULT 1;    -- a thin line above it
ALTER TABLE mailboxes ADD COLUMN logo_key TEXT;                                -- its file in storage (NULL: no logo)
ALTER TABLE mailboxes ADD COLUMN logo_type TEXT;                               -- image/png, image/jpeg or image/gif
ALTER TABLE mailboxes ADD COLUMN logo_ratio REAL;                              -- height / width of the image
ALTER TABLE mailboxes ADD COLUMN logo_width INTEGER NOT NULL DEFAULT 120;      -- pixels it is shown at
ALTER TABLE mailboxes ADD COLUMN logo_link TEXT NOT NULL DEFAULT '';
ALTER TABLE mailboxes ADD COLUMN logo_position TEXT NOT NULL DEFAULT 'left';   -- left of the text, or above it
