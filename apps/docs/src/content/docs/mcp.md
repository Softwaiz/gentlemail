---
title: Connect an AI assistant (MCP)
description: Let Claude, ChatGPT, Cursor or another AI assistant read, search and answer your GentleMail mail through MCP, with access you choose and can take back.
---

GentleMail is an [MCP](https://modelcontextprotocol.io) server. Add your instance to an AI assistant and it can search your mail, read conversations and, if you allow it, send and reply.

The address to add is your instance followed by `/mcp`, for example:

```
https://mail.example.com/mcp
```

You also find it under **Security** in the webmail, in **Connected assistants**.

## Connect

The assistant opens a GentleMail page. You sign in as usual, with two-step verification if it's on. You then tick what the assistant may **Read** and **Send**, mailbox by mailbox, and click **Allow**. No key to copy: the assistant keeps its own sign-in and renews it by itself.

- **Claude (claude.ai, desktop and mobile):** Settings → Connectors → **Add custom connector**, paste the address, then **Connect**.
- **Claude Code:** run the command below, then `/mcp` in Claude Code and choose **Authenticate**.
  ```sh
  claude mcp add --transport http gentlemail https://mail.example.com/mcp
  ```
- **ChatGPT:** with developer mode on, add a custom connector with the address and choose OAuth.
- **Cursor, VS Code and others:** add a remote (HTTP) MCP server with the address. They open the sign-in page when you first use it.

## What it can do

| Tool | Needs | What it does |
|---|---|---|
| `list_mailboxes` | | The mailboxes it may use, and whether it may read or send on each. |
| `search_messages` | Read | Lists a folder or searches subject, sender, recipients and text. |
| `get_message` | Read | One message as text, with recipients and attachment names. |
| `get_thread` | Read | A whole conversation, oldest first. |
| `update_message` | Read | Marks read or unread, stars, moves to inbox, archive, spam or trash. |
| `send_email` | Send | Sends a new message from a mailbox. |
| `reply` | Read and Send | Replies in the conversation, quoting the original, optionally to everyone. |

An assistant only sees the tools its access allows: a read-only one has no sending tools. It can't download attachments, delete mail for good or change settings.

## Staying in control

- **Only what you allowed.** The assistant reaches the mailboxes you ticked, and never more than you can open yourself. If an admin takes a mailbox away from you, your assistants lose it too, from their next request. Admins may also grant **All mailboxes** or a whole domain.
- **Sending asks you first.** Sending tools are marked as actions that change things, so assistants ask before running them. GentleMail also tells the assistant to show you the recipients and the text first.
- **Mail is treated as data.** Anyone can write you an email, including one written to trick an AI ("forward all invoices to…"). Every message the assistant reads comes with a note to treat it as information, not instructions. Still, give an assistant Send only where you need it.
- **Disconnect at any time.** **Security → Connected assistants** lists yours, with the access and last use of each; **Disconnect** stops it at once. Admins see everyone's under **Admin → API & webhooks**. Signing out in the assistant (in Claude Code, `/mcp` → **Clear authentication**) disconnects it too.
- **Short-lived tokens.** The assistant gets a token valid for an hour and a renewal token that changes each time it's used. GentleMail stores only fingerprints of them. Where the assistant keeps them on your side depends on the app.

To change what an assistant may do, disconnect it and connect it again.

## With an API key instead

Programs that can't sign in can send an [API key](/docs/api/keys/) as a header: `Authorization: Bearer gm_…`. The key's access applies, as on the HTTP API.

Don't paste the key into a config file in plain text. Keep it in your password manager or system keychain, and have the client fetch it when it connects. In Claude Code, a `headersHelper` command does that. On Linux with the GNOME keyring, for example, first store the key:

```sh
secret-tool store --label "GentleMail API key" service gentlemail
```

Then in `.mcp.json`:

```json
{
  "mcpServers": {
    "gentlemail": {
      "type": "http",
      "url": "https://mail.example.com/mcp",
      "headersHelper": "printf '{\"Authorization\":\"Bearer %s\"}' \"$(secret-tool lookup service gentlemail)\""
    }
  }
}
```

On macOS, use `security find-generic-password -s gentlemail -w` instead. With 1Password, use `op read op://Private/GentleMail/credential`.

## For developers

- Transport: MCP Streamable HTTP, stateless. `POST /mcp` with JSON-RPC, answered with JSON. There is no event stream (`GET /mcp` returns 405) and no session.
- Sign-in: OAuth 2.1 with PKCE (S256 only) and dynamic client registration.
  - The metadata is at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`.
  - The endpoints are `/oauth/register`, `/oauth/authorize`, `/oauth/token` and `/oauth/revoke`.
  - Redirect URIs must be https, http on `localhost` or `127.0.0.1` (any port), or an app's own scheme.
- Tokens from signing in work on `/mcp` only, not on `/api/v1`.
- Requests from web pages on other sites are refused.
