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

Signed in, the first of these that exists wins:

1. The language saved on your account.
2. Your browser's language, if GentleMail has it (**Same as browser**).
3. English.

Signed out, on the sign-in page:

1. The language of the account last used on this device, kept in a cookie. It's cleared when that account is on **Same as browser**.
2. Your browser's language, if GentleMail has it.
3. English.

A cookie left on a shared computer by someone else never changes the language once you're signed in.

The language isn't in the address of the page: links work the same for everyone.

## What stays in English

- The [API](/docs/api/), its errors and [webhooks](/docs/webhooks/): programs read them, and errors come with stable codes to translate in your own app.
- The [MCP tools](/docs/mcp/) that AI assistants call. The page where you connect an assistant is translated.
- The mail itself: GentleMail never changes the text of messages people send or receive, and the lines it adds above a quoted message ("On 18 Feb 2026, 11:06 UTC, Ada wrote:") are always in English.

## Adding a language

Every word on screen comes from a key in a catalog, in `apps/mail/src/locales/<language>/messages.po`. Adding a language is adding a catalog:

1. In `apps/mail/lingui.config.ts`, add its code to `locales` (`"es"`).
2. Run `npm run i18n` from `apps/mail`. It creates `src/locales/es/messages.po` with every key, untranslated.
3. Fill in each `msgstr` with the text in that language. Keep the values as they are: `{0}`, `{name}`, `<0>…</0>` and the plural forms (`{count, plural, one {…} other {…}}`, with the forms that language needs).
4. In `src/lib/i18n.ts`, add it to `LOCALES`, import its catalog, and give its name in its own language in `LOCALE_NAMES` (`Español`).
5. Run `npm run i18n` again: the app uses the compiled `messages.ts` it writes, not the `.po` file, and it counts what's left to translate. A key not translated yet shows in English, never blank.
6. `npm test` checks that every English key is translated, with the same values.

Changing text on screen works the same way: write it in the code as `t({ id: "area.key", message: "English text" })` (or `<Trans id="…">` for text with markup), run `npm run i18n`, translate the new key in each `messages.po`, then run `npm run i18n` again so the app gets the translation. When you reword an existing text, update its translations too: they stay as they were. `npm test` fails on text written straight in a page, on a key missing from a catalog, and on catalogs that don't match the code or weren't compiled.
