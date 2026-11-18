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

- **Claude (claude.ai, desktop and mobile):** on claude.ai, Settings → Connectors → **Add custom connector**, paste the address, then **Connect**. The connector then shows up in the desktop and mobile apps too.
- **Claude Code:** run the command below, then `/mcp` in Claude Code and choose **Authenticate**.
  ```sh
  claude mcp add --transport http gentlemail https://mail.example.com/mcp
  ```
- **Other assistants** (ChatGPT in developer mode, Cursor, VS Code…): add a remote MCP server, also called a custom connector or HTTP server, with the address, and choose OAuth if asked. They open the sign-in page the first time you use it.

Your instance must be reachable over HTTPS, as it is once deployed: assistants refuse plain `http://` addresses, except on your own computer.

## Things to ask it

Ask in your own words; the assistant picks the tools. For example:

- "What came in on support@ today? Summarise each message in one line."
- "Do I have unread mail from Paul? Open the latest conversation and tell me what he needs."
- "Find the invoice from Acme last month and give me the amount and due date."
- "Draft a reply to that message saying we'll ship on Friday. Show it to me before sending."
- "Reply to everyone in that thread that the meeting moves to 3pm."
- "Mark the newsletters in my inbox as read and archive them."
- "Move that message to spam."
- "Send an email from hello@ to anna@example.com thanking her for the call, signed with my signature."

When it's about to send, the assistant shows you the message and waits for your go-ahead. On a mailbox it may only read, it can't send at all.

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
- **Disconnect at any time.** **Security → Connected assistants** lists yours, with the access and last use of each; **Disconnect** stops it at once. Admins see everyone's under **Admin → API & webhooks**. Signing out in the assistant (in Claude Code, `/mcp` → **Clear authentication**) signs out that device only; the others stay connected until the last one signs out. An assistant that none of your devices has used for 60 days is removed.
- **Password or two-step reset.** When an admin changes someone's password, their own included, or resets someone's two-step verification, that person's assistants are disconnected too, in case whoever knew the old password connected one.
- **Short-lived tokens.** The assistant gets a token valid for an hour and a renewal token that changes each time it's used. If an old renewal token is used again more than 30 seconds later, someone has copied it, and that device is signed out. Once within 30 seconds, it's taken for the app retrying. GentleMail stores only fingerprints of them. Where the assistant keeps them on your side depends on the app.

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
- Each sign-in is its own chain of tokens. `/oauth/revoke` ends the chain the token belongs to. A refresh token used again within 30 seconds of its first use gets a new pair, once (a retry); any other reuse ends its chain. A `redirect_uri` sent to `/oauth/authorize` must be repeated at `/oauth/token`.
- Registration takes up to 5 redirect URIs of up to 500 characters, and 10 registrations a minute from one address (`429 slow_down` beyond).
- An assistant whose person can no longer open any of its mailboxes gets `401`, and refreshing fails with `invalid_grant`, so it signs in again. JSON-RPC batches (older protocol versions) hold at most 10 messages.
- `/mcp`, the OAuth endpoints and the discovery documents answer any site (CORS), for assistants that run in a browser. They read only the tokens sent with the request, never the webmail's cookies.
