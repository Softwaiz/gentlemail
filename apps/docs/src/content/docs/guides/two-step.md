---
title: Two-step verification
description: Protect GentleMail sign-ins with an authenticator app and recovery codes, and require it for everyone.
---

With two-step verification, signing in needs your password **and** a 6-digit code from an authenticator app on your phone. Someone who learns your password still can't get in.

It works with any authenticator app: Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden, Authy and others.

## Turn it on

1. Open **Security** from the menu under your name.
2. Choose **Set up two-step verification**, and scan the QR code with your app. Can't scan it? Choose "Enter a setup key" in the app and type the key shown.
3. Enter the 6-digit code the app shows. Two-step verification is on.
4. **Save your recovery codes.** You get 10, shown once: download them as a `.txt` file or copy them into your password manager.

## Signing in

After your password, enter the current code from your app. If a code doesn't work, check that your phone sets its time automatically, then use the newest code.

- After 5 wrong codes, you're asked for your password again.
- A code can't be used twice.

## Lost your phone?

Type one of your **recovery codes** in the code box. Each one works once, and GentleMail tells you how many are left. Then, on **Security**:

- **Turn off** two-step verification and set it up again on your new phone, or
- make **new recovery codes** (the old ones stop working).

Lost both the phone and the recovery codes? Ask an admin to **reset** it for you (below).

## For admins

In **Admin → Users**:

- **Require two-step verification for everyone.** When it's on, people who haven't set it up can only open the Security page until they do. When it's off, each person decides for themselves.
- The **Two-step** column shows who has it on.
- **Reset two-step** is for someone who lost their phone and their recovery codes. It turns two-step off and signs them out everywhere, [AI assistants](/docs/mcp/) included; they sign in with their password and set it up again.

Two-step verification protects signing in to the web app. Programs using the [API](/docs/api/) use API keys instead, which you can limit to exactly the mailboxes and permissions they need.
