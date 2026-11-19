-- A third permission beside read and send: organize, to mark a message read or
-- unread, star it, or move it to the inbox, archive, spam or trash. Until now
-- read allowed that too, so an assistant let in "only to read" could still
-- archive or trash mail.
--
-- Existing API keys and assistant connections don't get it: an admin ticks it
-- on keys that need it, and an assistant is connected again.

ALTER TABLE api_key_grants ADD COLUMN can_organize INTEGER NOT NULL DEFAULT 0;
