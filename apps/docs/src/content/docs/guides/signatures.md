---
title: Signatures
description: A formatted signature with your logo on every mailbox, how it is sent, and how to leave it out of a message.
---

Each mailbox has its own signature, shared by everyone who uses it. It's added below new messages, replies and forwards.

## Writing it

Open **Mailbox settings** in the mailbox. Admins can also open the mailbox from **Admin**. Write under **Signature** with the same formatting as a message: bold, italic, links, lists… **How it looks** shows the result as you type.

A mailbox with nothing written and no logo has no signature.

## Adding a logo

**Add logo** takes a PNG, JPEG or GIF of up to 200 KB. Then choose:

- **Width**, from 40 to 320 pixels. For a sharp logo on every screen, use an image about twice as wide.
- **Position**: left of the text or above it.
- **Logo link**: the page it opens, if any.

The logo is sent inside each message. Recipients see it without loading anything from your server, and you don't learn when they open it. Use an image that reads on both white and dark backgrounds: some mail apps show messages in a dark theme.

Replies and forwards carry the logo too. Changing it doesn't change messages already sent.

## The line above it

A thin line separates your message from the signature. Turn off **Line above the signature** to send it without one. The plain-text version of a message keeps the usual `-- ` line, which mail programs recognize as the start of a signature.

## Leaving it out

Untick **Add signature** under the message you're writing. Messages sent with the [API](/docs/api/send/) carry the signature only with `"signature": true`. [AI assistants](/docs/mcp/) add it unless you ask them not to.
