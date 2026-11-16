---
title: Spam and blocking
description: How GentleMail keeps out unwanted mail, from Cloudflare's checks to per-mailbox blocked and trusted senders.
---

Unwanted mail can be stopped at four levels, from the widest to the narrowest.

1. **Cloudflare, before GentleMail.** Email Routing refuses mail that fails SPF and DKIM, fails the sender's DMARC policy, or comes from blocklisted servers. In the dashboard, a routing rule for one address with the action **Drop** discards its mail before it reaches your Worker.
2. **A whole domain or mailbox.** Turn it off in Admin and its mail is refused. Addresses that don't exist are refused too (550).
3. **A sender.** Mark a message as spam and its sender is blocked for that mailbox: their next messages go straight to Spam. **Not spam** does the opposite and trusts the sender, who then skips every rule. **Mailbox settings** lists both, and removing a sender there undoes it.
4. **A spam score.** Set `SPAM_SCORE_THRESHOLD` in `wrangler.jsonc` to move mail whose Cloudflare spam score (`X-Cf-Spamh-Score`, up to 5, higher is spammier) reaches it to Spam. It's off by default; if you turn it on, start at `5`.

A message also goes to Spam when it arrives flagged `X-Spam-Flag: YES`, or when DMARC failed but the sender's policy didn't enforce it (`p=none` or `p=quarantine`).

Spam never triggers [webhooks](/docs/webhooks/) and is deleted after 30 days.
