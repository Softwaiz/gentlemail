-- The language each person picks in their user menu (an i18n locale such as 'en' or 'fr').
-- NULL until they pick one: their browser's language is used.
ALTER TABLE users ADD COLUMN language TEXT;
