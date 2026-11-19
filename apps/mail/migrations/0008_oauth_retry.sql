-- A refresh retried within 30 seconds (two tabs, an answer lost on the way) gets
-- back the same pair as the first time, instead of a second one.
--
-- answer: on a used refresh token, the pair it was traded for, encrypted with a
-- key derived from that refresh token, which is never stored (only its hash
-- is). Cleared by the hourly clean-up once the 30 seconds are over.

ALTER TABLE oauth_tokens ADD COLUMN answer TEXT;
