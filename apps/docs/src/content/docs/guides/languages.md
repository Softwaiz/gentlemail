---
title: Languages
description: The webmail in English or French, how each person's language is chosen, and how to add a language.
---

The webmail is in English and French. Each person picks their language; nothing to set up on the server.

## Picking a language

Open the menu under your name, at the bottom of the sidebar, and choose under **Language**:

- **English** or **Français**: saved on your account, so your phone and every other device you sign in on follow it.
- **Same as browser**: the webmail follows your browser's language, and English when the browser asks for one GentleMail doesn't have.

The page reloads in the new language.

## How the language is chosen

For each page, the first of these that exists wins:

1. The language saved on your account (when signed in).
2. The last language picked on this device. The sign-in page uses it, and signing in on a new device writes your account's language there.
3. Your browser's language, if GentleMail has it.
4. English.

The language isn't in the address of the page: links work the same for everyone.

## What stays in English

- The [API](/docs/api/), its errors and [webhooks](/docs/webhooks/): programs read them, and errors come with stable codes to translate in your own app.
- The [MCP tools](/docs/mcp/) that AI assistants call. The page where you connect an assistant is translated.
- The mail itself: GentleMail never changes the text of messages people send or receive.

## Adding a language

Every word on screen comes from a key in a catalog, in `apps/mail/src/locales/<language>/messages.po`. Adding a language is adding a catalog:

1. In `apps/mail/lingui.config.ts`, add its code to `locales` (`"es"`).
2. Run `npm run i18n` from `apps/mail`. It creates `src/locales/es/messages.po` with every key, untranslated.
3. Fill in each `msgstr` with the text in that language. Keep the values as they are: `{0}`, `{name}`, `<0>…</0>` and the plural forms (`{count, plural, one {…} other {…}}`, with the forms that language needs).
4. In `src/lib/i18n.ts`, add it to `LOCALES`, import its catalog, and give its name in its own language in `LOCALE_NAMES` (`Español`).
5. Run `npm run i18n` again: it counts what's left to translate. A key not translated yet shows in English, never blank.
6. `npm test` checks that every English key is translated, with the same values.

Changing text on screen works the same way: write it in the code as `t({ id: "area.key", message: "English text" })` (or `<Trans id="…">` for text with markup), run `npm run i18n`, and translate the new key. `npm test` fails on text written straight in a page, and on a key missing from a catalog.
