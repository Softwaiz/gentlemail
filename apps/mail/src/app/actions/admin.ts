"use server";

import { env } from "cloudflare:workers";
import { requestInfo, serverAction } from "rwsdk/worker";
import { type ActionResult, adminOnly, fail, ok, text } from "@/app/actions/guards";
import { createApiKey, endConnections, grantsFromForm, setApiKeyGrants } from "@/lib/apikeys";
import { createUser, currentSessionId, hashPassword } from "@/lib/auth";
import { type Domain, type Mailbox, isDomainActive } from "@/lib/db";
import { isEmail, newId, now } from "@/lib/util";
import { type DeliveryRow, EVENTS, type WebhookRow, attemptDelivery, newSecret, sendTestEvent } from "@/lib/webhooks";
import { t } from "@lingui/core/macro";

/*
 * Admin mutations. Each one checks the caller is an admin (adminOnly), then
 * returns an ActionResult; rwsdk re-renders the current page with fresh data.
 */

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_RE = /^[a-z0-9._+\-]+$/;

const me = () => requestInfo.ctx.user!;
const mailboxExists = async (id: string) => !!(await env.DB.prepare("SELECT 1 FROM mailboxes WHERE id = ?").bind(id).first());

/** Replaces the member list of a mailbox (admins always have access, so they're skipped). */
function memberStatements(mailboxId: string, userIds: string[]) {
  return [
    env.DB.prepare("DELETE FROM mailbox_members WHERE mailbox_id = ?").bind(mailboxId),
    ...userIds.map((uid) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO mailbox_members (mailbox_id, user_id) SELECT ?, id FROM users WHERE id = ? AND role != 'admin'",
      ).bind(mailboxId, uid),
    ),
  ];
}

/** Replaces the mailboxes a user can open. */
function accessStatements(userId: string, mailboxIds: string[]) {
  return [
    env.DB.prepare("DELETE FROM mailbox_members WHERE user_id = ?").bind(userId),
    ...mailboxIds.map((mid) =>
      env.DB.prepare(
        "INSERT OR IGNORE INTO mailbox_members (mailbox_id, user_id) SELECT id, ? FROM mailboxes WHERE id = ?",
      ).bind(userId, mid),
    ),
  ];
}

/* ---------- Domains ---------- */

export const createDomain = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const name = text(form, "name").toLowerCase().replace(/^@/, "").replace(/\.$/, "");
    if (!DOMAIN_RE.test(name)) return fail(t({ id: "admin.doesnt_look_like_domain", message: "That doesn't look like a domain name, for example acme.com." }));
    if (await env.DB.prepare("SELECT 1 FROM domains WHERE name = ?").bind(name).first()) return fail(t({ id: "admin.domain_exists", message: `${name} is already added.` }));
    const id = newId();
    await env.DB.prepare("INSERT INTO domains (id, name, active, created_at) VALUES (?, ?, 1, ?)").bind(id, name, now()).run();
    return ok(t({ id: "admin.domain_added", message: `${name} added. Finish connecting it below.` }), { redirect: `/admin/domains/${id}` });
  },
]);

export const setDomainActive = serverAction([
  adminOnly,
  async (id: string, active: boolean): Promise<ActionResult> => {
    await env.DB.prepare("UPDATE domains SET active = ? WHERE id = ?").bind(active ? 1 : 0, id).run();
    return ok(active ? t({ id: "admin.domain_turned", message: "Domain turned on." }) : t({ id: "admin.domain_turned_off_mail", message: "Domain turned off. Its mail is now rejected." }));
  },
]);

export const deleteDomain = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    const domain = await env.DB.prepare("SELECT * FROM domains WHERE id = ?").bind(id).first<Domain>();
    if (!domain) return fail(t({ id: "admin.domain_no_longer_exists", message: "This domain no longer exists." }));
    const used = await env.DB.prepare("SELECT 1 FROM mailboxes WHERE address LIKE ? LIMIT 1").bind(`%@${domain.name}`).first();
    if (used) return fail(t({ id: "admin.delete_mailboxes_domain_first", message: "Delete the mailboxes on this domain first." }));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(id),
      env.DB.prepare("DELETE FROM api_key_grants WHERE target_type = 'domain' AND target_id = ?").bind(id),
    ]);
    return ok(t({ id: "admin.domain_removed", message: `${domain.name} removed.` }), { redirect: "/admin" });
  },
]);

/* ---------- Mailboxes ---------- */

export const createMailbox = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const local = text(form, "local").toLowerCase();
    const domain = text(form, "domain").toLowerCase();
    if (!domain) return fail(t({ id: "admin.pick_domain", message: "Pick a domain." }));
    if (!(await isDomainActive(domain))) return fail(t({ id: "admin.domain_unknown_turned_off", message: "That domain is unknown or turned off." }));
    const address = `${local}@${domain}`;
    if (!LOCAL_RE.test(local) || !isEmail(address)) return fail(t({ id: "admin.use_letters_numbers_dots", message: "Use letters, numbers, dots, dashes or + before the @." }));
    if (await env.DB.prepare("SELECT 1 FROM mailboxes WHERE address = ?").bind(address).first()) return fail(t({ id: "admin.mailbox_exists", message: `${address} already exists.` }));
    const id = newId();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO mailboxes (id, address, display_name, signature, active, created_at) VALUES (?, ?, ?, '', 1, ?)",
      ).bind(id, address, text(form, "display_name") || local, now()),
      ...memberStatements(id, form.getAll("members").map(String)),
    ]);
    return ok(t({ id: "admin.mailbox_created", message: `${address} created.` }));
  },
]);

export const updateMailbox = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const id = text(form, "id");
    const mailbox = await env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(id).first<Mailbox>();
    if (!mailbox) return fail(t({ id: "admin.mailbox_no_longer_exists", message: "This mailbox no longer exists." }));
    await env.DB.prepare("UPDATE mailboxes SET display_name = ?, signature = ?, active = ? WHERE id = ?")
      .bind(
        text(form, "display_name") || mailbox.display_name,
        String(form.get("signature") ?? "").slice(0, 5000),
        form.get("active") === "on" || form.get("active") === "1" ? 1 : 0,
        id,
      )
      .run();
    return ok(t({ id: "admin.mailbox_saved", message: "Mailbox saved." }));
  },
]);

export const setMailboxMembers = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const id = text(form, "id");
    if (!(await mailboxExists(id))) return fail(t({ id: "admin.mailbox_no_longer_exists", message: "This mailbox no longer exists." }));
    await env.DB.batch(memberStatements(id, form.getAll("members").map(String)));
    return ok(t({ id: "admin.access_updated", message: "Access updated." }));
  },
]);

export const deleteMailbox = serverAction([
  adminOnly,
  async (id: string, confirm: string): Promise<ActionResult> => {
    const mailbox = await env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(id).first<Mailbox>();
    if (!mailbox) return fail(t({ id: "admin.mailbox_no_longer_exists", message: "This mailbox no longer exists." }));
    if (confirm.trim().toLowerCase() !== mailbox.address.toLowerCase()) return fail(t({ id: "admin.type_exact_address_confirm", message: "Type the exact address to confirm." }));
    // Files first, then rows (messages and attachments cascade).
    for (const prefix of [`raw/${id}/`, `att/${id}/`, `bodies/${id}/`]) {
      let cursor: string | undefined;
      do {
        const list = await env.MAIL_BUCKET.list({ prefix, cursor });
        if (list.objects.length) await env.MAIL_BUCKET.delete(list.objects.map((o) => o.key));
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM mailboxes WHERE id = ?").bind(id),
      env.DB.prepare("DELETE FROM api_key_grants WHERE target_type = 'mailbox' AND target_id = ?").bind(id),
    ]);
    return ok(t({ id: "admin.mailbox_deleted", message: `${mailbox.address} deleted.` }), { redirect: "/admin" });
  },
]);

/* ---------- Users ---------- */

export const createUserAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const email = text(form, "email").toLowerCase();
    const password = String(form.get("password") ?? "");
    const role = text(form, "role") === "admin" ? "admin" : "member";
    if (!text(form, "name")) return fail(t({ id: "admin.enter_name", message: "Enter a name." }));
    if (!isEmail(email)) return fail(t({ id: "admin.enter_valid_login_email", message: "Enter a valid login email." }));
    if (password.length < 10) return fail(t({ id: "admin.password_needs_least_10", message: "The password needs at least 10 characters." }));
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) return fail(t({ id: "admin.someone_already_signs_email", message: "Someone already signs in with that email." }));
    const id = await createUser({ email, name: text(form, "name"), password, role });
    if (role === "member") await env.DB.batch(accessStatements(id, form.getAll("mailboxes").map(String)));
    return ok(t({ id: "admin.user_added", message: `${text(form, "name")} added.` }));
  },
]);

export const updateUserAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const id = text(form, "id");
    const user = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first<{ id: string; role: string }>();
    if (!user) return fail(t({ id: "admin.user_no_longer_exists", message: "This user no longer exists." }));
    const isSelf = id === me().id;
    const email = text(form, "email").toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!text(form, "name")) return fail(t({ id: "admin.enter_name", message: "Enter a name." }));
    if (!isEmail(email)) return fail(t({ id: "admin.enter_valid_login_email", message: "Enter a valid login email." }));
    if (password && password.length < 10) return fail(t({ id: "admin.new_password_needs_least", message: "The new password needs at least 10 characters." }));
    const role = isSelf ? user.role : text(form, "role") === "admin" ? "admin" : "member";

    const stmts = [env.DB.prepare("UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?").bind(text(form, "name"), email, role, id)];
    if (password) {
      stmts.push(env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), id));
      // Whoever knew the old password may be signed in or have connected an assistant: both end.
      // Your own password: every session but this one.
      stmts.push(...endConnections(id));
      const keep = isSelf ? await currentSessionId(requestInfo.request) : null;
      stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?").bind(id, keep));
    }
    if (role === "member") stmts.push(...accessStatements(id, form.getAll("mailboxes").map(String)));
    try {
      await env.DB.batch(stmts);
    } catch {
      return fail(t({ id: "admin.someone_else_already_signs", message: "Someone else already signs in with that email." }));
    }
    return ok(t({ id: "admin.user_saved", message: "User saved." }));
  },
]);

export const deleteUserAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    if (id === me().id) return fail(t({ id: "admin.cant_remove_yourself", message: "You can't remove yourself." }));
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
    return ok(t({ id: "admin.user_removed_their_mailboxes", message: "User removed. Their mailboxes and mail are kept." }));
  },
]);

/* ---------- API keys ---------- */

export const createKeyAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult<{ name: string; key: string }>> => {
    const name = text(form, "name").slice(0, 80);
    if (!name) return fail(t({ id: "admin.give_key_name_such", message: "Give the key a name, such as the program that uses it." }));
    const grants = await grantsFromForm(form);
    if (!grants.length) return fail(t({ id: "admin.tick_read_organize_send", message: "Tick Read, Organize or Send on at least one line." }));
    // The key goes back in the action result only, never into a URL or the page.
    const { key } = await createApiKey({ name, grants, userId: me().id });
    return ok(t({ id: "admin.key_created", message: "Key created." }), { data: { name, key } });
  },
]);

/** Changes what an existing key can read, organize and send; programs using it keep the same key. */
export const updateKeyAccessAction = serverAction([
  adminOnly,
  async (id: string, form: FormData): Promise<ActionResult> => {
    const key = await env.DB.prepare("SELECT id FROM api_keys WHERE id = ? AND revoked_at IS NULL AND user_id IS NULL").bind(id).first();
    if (!key) return fail(t({ id: "admin.key_no_longer_exists", message: "This key no longer exists or was revoked." }));
    const grants = await grantsFromForm(form);
    if (!grants.length) return fail(t({ id: "admin.tick_read_organize_send_2", message: "Tick Read, Organize or Send on at least one line, or revoke the key instead." }));
    await setApiKeyGrants(id, grants);
    return ok(t({ id: "admin.key_access_updated_applies", message: "Key access updated. It applies from the next request." }));
  },
]);

export const revokeKeyAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    await env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND user_id IS NULL").bind(now(), id).run();
    return ok(t({ id: "admin.key_revoked_programs_using", message: "Key revoked. Programs using it are refused from now on." }));
  },
]);

/* ---------- Webhooks ---------- */

function readHook(form: FormData): { error: string } | { name: string; url: string; events: string[]; mailboxId: string | null } {
  const name = text(form, "name").slice(0, 80);
  const events = form.getAll("events").map(String).filter((e) => EVENTS.some((x) => x.id === e));
  let url: URL | null = null;
  try {
    url = new URL(text(form, "url"));
  } catch {}
  if (!name) return { error: t({ id: "admin.give_webhook_name", message: "Give the webhook a name." }) };
  if (!url || url.protocol !== "https:") return { error: t({ id: "admin.url_must_start_https", message: "The URL must start with https://." }) };
  if (!events.length) return { error: t({ id: "admin.pick_least_one_event", message: "Pick at least one event." }) };
  const mailbox = text(form, "mailbox_id");
  return { name, url: url.toString(), events, mailboxId: mailbox && mailbox !== "all" ? mailbox : null };
}

export const createWebhookAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const h = readHook(form);
    if ("error" in h) return fail(h.error);
    if (h.mailboxId && !(await mailboxExists(h.mailboxId))) return fail(t({ id: "admin.pick_mailbox", message: "Pick a mailbox." }));
    const id = newId();
    await env.DB.prepare(
      "INSERT INTO webhooks (id, name, url, secret, mailbox_id, events, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
      .bind(id, h.name, h.url, newSecret(), h.mailboxId, h.events.join(","), now())
      .run();
    return ok(t({ id: "admin.webhook_added_copy_signing", message: "Webhook added. Copy the signing secret into your receiver." }), { redirect: `/admin/webhooks/${id}` });
  },
]);

export const updateWebhookAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const id = text(form, "id");
    const h = readHook(form);
    if ("error" in h) return fail(h.error);
    if (h.mailboxId && !(await mailboxExists(h.mailboxId))) return fail(t({ id: "admin.pick_mailbox", message: "Pick a mailbox." }));
    await env.DB.prepare("UPDATE webhooks SET name = ?, url = ?, mailbox_id = ?, events = ?, active = ? WHERE id = ?")
      .bind(h.name, h.url, h.mailboxId, h.events.join(","), form.get("active") === "on" ? 1 : 0, id)
      .run();
    return ok(t({ id: "admin.webhook_saved", message: "Webhook saved." }));
  },
]);

const loadHook = (id: string) => env.DB.prepare("SELECT * FROM webhooks WHERE id = ?").bind(id).first<WebhookRow>();

export const testWebhookAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    const hook = await loadHook(id);
    if (!hook) return fail(t({ id: "admin.webhook_no_longer_exists", message: "This webhook no longer exists." }));
    return (await sendTestEvent(hook)) ? ok(t({ id: "admin.test_event_delivered", message: "Test event delivered." })) : fail(t({ id: "admin.test_event_failed_see", message: "Test event failed. See the delivery log." }));
  },
]);

export const retryDeliveryAction = serverAction([
  adminOnly,
  async (hookId: string, deliveryId: string): Promise<ActionResult> => {
    const hook = await loadHook(hookId);
    const d = await env.DB.prepare("SELECT * FROM webhook_deliveries WHERE id = ? AND webhook_id = ?")
      .bind(deliveryId, hookId)
      .first<DeliveryRow>();
    if (!hook || !d) return fail(t({ id: "admin.delivery_no_longer_exists", message: "This delivery no longer exists." }));
    return (await attemptDelivery({ ...d, attempts: 0 }, hook)) ? ok(t({ id: "admin.delivered", message: "Delivered." })) : fail(t({ id: "admin.still_failing_retried_automatically", message: "Still failing. It's retried automatically." }));
  },
]);

export const rotateSecretAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    await env.DB.prepare("UPDATE webhooks SET secret = ? WHERE id = ?").bind(newSecret(), id).run();
    return ok(t({ id: "admin.new_secret_generated_update", message: "New secret generated. Update your receiver." }));
  },
]);

export const deleteWebhookAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    await env.DB.prepare("DELETE FROM webhooks WHERE id = ?").bind(id).run();
    return ok(t({ id: "admin.webhook_deleted", message: "Webhook deleted." }), { redirect: "/admin/api" });
  },
]);
