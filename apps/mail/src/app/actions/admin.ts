"use server";

import { env } from "cloudflare:workers";
import { requestInfo, serverAction } from "rwsdk/worker";
import { type ActionResult, adminOnly, fail, ok, text } from "@/app/actions/guards";
import { createApiKey, SCOPES, type Scope } from "@/lib/apikeys";
import { createUser, hashPassword } from "@/lib/auth";
import { type Domain, type Mailbox, isDomainActive } from "@/lib/db";
import { isEmail, newId, now } from "@/lib/util";
import { type DeliveryRow, EVENTS, type WebhookRow, attemptDelivery, newSecret, sendTestEvent } from "@/lib/webhooks";

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
    if (!DOMAIN_RE.test(name)) return fail("That doesn't look like a domain name, for example acme.com.");
    if (await env.DB.prepare("SELECT 1 FROM domains WHERE name = ?").bind(name).first()) return fail(`${name} is already added.`);
    const id = newId();
    await env.DB.prepare("INSERT INTO domains (id, name, active, created_at) VALUES (?, ?, 1, ?)").bind(id, name, now()).run();
    return ok(`${name} added. Finish connecting it below.`, { redirect: `/admin/domains/${id}` });
  },
]);

export const setDomainActive = serverAction([
  adminOnly,
  async (id: string, active: boolean): Promise<ActionResult> => {
    await env.DB.prepare("UPDATE domains SET active = ? WHERE id = ?").bind(active ? 1 : 0, id).run();
    return ok(active ? "Domain turned on." : "Domain turned off. Its mail is now rejected.");
  },
]);

export const deleteDomain = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    const domain = await env.DB.prepare("SELECT * FROM domains WHERE id = ?").bind(id).first<Domain>();
    if (!domain) return fail("This domain no longer exists.");
    const used = await env.DB.prepare("SELECT 1 FROM mailboxes WHERE address LIKE ? LIMIT 1").bind(`%@${domain.name}`).first();
    if (used) return fail("Delete the mailboxes on this domain first.");
    await env.DB.prepare("DELETE FROM domains WHERE id = ?").bind(id).run();
    return ok(`${domain.name} removed.`, { redirect: "/admin" });
  },
]);

/* ---------- Mailboxes ---------- */

export const createMailbox = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const local = text(form, "local").toLowerCase();
    const domain = text(form, "domain").toLowerCase();
    if (!domain) return fail("Pick a domain.");
    if (!(await isDomainActive(domain))) return fail("That domain is unknown or turned off.");
    const address = `${local}@${domain}`;
    if (!LOCAL_RE.test(local) || !isEmail(address)) return fail("Use letters, numbers, dots, dashes or + before the @.");
    if (await env.DB.prepare("SELECT 1 FROM mailboxes WHERE address = ?").bind(address).first()) return fail(`${address} already exists.`);
    const id = newId();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO mailboxes (id, address, display_name, signature, active, created_at) VALUES (?, ?, ?, '', 1, ?)",
      ).bind(id, address, text(form, "display_name") || local, now()),
      ...memberStatements(id, form.getAll("members").map(String)),
    ]);
    return ok(`${address} created.`);
  },
]);

export const updateMailbox = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const id = text(form, "id");
    const mailbox = await env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(id).first<Mailbox>();
    if (!mailbox) return fail("This mailbox no longer exists.");
    await env.DB.prepare("UPDATE mailboxes SET display_name = ?, signature = ?, active = ? WHERE id = ?")
      .bind(
        text(form, "display_name") || mailbox.display_name,
        String(form.get("signature") ?? "").slice(0, 5000),
        form.get("active") === "on" || form.get("active") === "1" ? 1 : 0,
        id,
      )
      .run();
    return ok("Mailbox saved.");
  },
]);

export const setMailboxMembers = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const id = text(form, "id");
    if (!(await mailboxExists(id))) return fail("This mailbox no longer exists.");
    await env.DB.batch(memberStatements(id, form.getAll("members").map(String)));
    return ok("Access updated.");
  },
]);

export const deleteMailbox = serverAction([
  adminOnly,
  async (id: string, confirm: string): Promise<ActionResult> => {
    const mailbox = await env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(id).first<Mailbox>();
    if (!mailbox) return fail("This mailbox no longer exists.");
    if (confirm.trim().toLowerCase() !== mailbox.address.toLowerCase()) return fail("Type the exact address to confirm.");
    // Files first, then rows (messages and attachments cascade).
    for (const prefix of [`raw/${id}/`, `att/${id}/`, `bodies/${id}/`]) {
      let cursor: string | undefined;
      do {
        const list = await env.MAIL_BUCKET.list({ prefix, cursor });
        if (list.objects.length) await env.MAIL_BUCKET.delete(list.objects.map((o) => o.key));
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    }
    await env.DB.prepare("DELETE FROM mailboxes WHERE id = ?").bind(id).run();
    return ok(`${mailbox.address} deleted.`, { redirect: "/admin" });
  },
]);

/* ---------- Users ---------- */

export const createUserAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const email = text(form, "email").toLowerCase();
    const password = String(form.get("password") ?? "");
    const role = text(form, "role") === "admin" ? "admin" : "member";
    if (!text(form, "name")) return fail("Enter a name.");
    if (!isEmail(email)) return fail("Enter a valid login email.");
    if (password.length < 10) return fail("The password needs at least 10 characters.");
    if (await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) return fail("Someone already signs in with that email.");
    const id = await createUser({ email, name: text(form, "name"), password, role });
    if (role === "member") await env.DB.batch(accessStatements(id, form.getAll("mailboxes").map(String)));
    return ok(`${text(form, "name")} added.`);
  },
]);

export const updateUserAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const id = text(form, "id");
    const user = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first<{ id: string; role: string }>();
    if (!user) return fail("This user no longer exists.");
    const isSelf = id === me().id;
    const email = text(form, "email").toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!text(form, "name")) return fail("Enter a name.");
    if (!isEmail(email)) return fail("Enter a valid login email.");
    if (password && password.length < 10) return fail("The new password needs at least 10 characters.");
    const role = isSelf ? user.role : text(form, "role") === "admin" ? "admin" : "member";

    const stmts = [env.DB.prepare("UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?").bind(text(form, "name"), email, role, id)];
    if (password) {
      stmts.push(env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), id));
      if (!isSelf) stmts.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id)); // sign them out elsewhere
    }
    if (role === "member") stmts.push(...accessStatements(id, form.getAll("mailboxes").map(String)));
    try {
      await env.DB.batch(stmts);
    } catch {
      return fail("Someone else already signs in with that email.");
    }
    return ok("User saved.");
  },
]);

export const deleteUserAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    if (id === me().id) return fail("You can't remove yourself.");
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
    return ok("User removed. Their mailboxes and mail are kept.");
  },
]);

/* ---------- API keys ---------- */

export const createKeyAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult<{ name: string; key: string }>> => {
    const name = text(form, "name").slice(0, 80);
    const mailboxId = text(form, "mailbox_id");
    const scopes = form.getAll("scopes").map(String).filter((s): s is Scope => SCOPES.some((x) => x.id === s));
    if (!name) return fail("Give the key a name, such as the program that uses it.");
    if (!scopes.length) return fail("Pick at least one permission.");
    if (mailboxId !== "all" && !(await mailboxExists(mailboxId))) return fail("Pick a mailbox.");
    // The key goes back in the action result only, never into a URL or the page.
    const { key } = await createApiKey({ name, mailboxId: mailboxId === "all" ? null : mailboxId, scopes, userId: me().id });
    return ok("Key created.", { data: { name, key } });
  },
]);

export const revokeKeyAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    await env.DB.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now(), id).run();
    return ok("Key revoked. Programs using it are refused from now on.");
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
  if (!name) return { error: "Give the webhook a name." };
  if (!url || url.protocol !== "https:") return { error: "The URL must start with https://." };
  if (!events.length) return { error: "Pick at least one event." };
  const mailbox = text(form, "mailbox_id");
  return { name, url: url.toString(), events, mailboxId: mailbox && mailbox !== "all" ? mailbox : null };
}

export const createWebhookAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const h = readHook(form);
    if ("error" in h) return fail(h.error);
    if (h.mailboxId && !(await mailboxExists(h.mailboxId))) return fail("Pick a mailbox.");
    const id = newId();
    await env.DB.prepare(
      "INSERT INTO webhooks (id, name, url, secret, mailbox_id, events, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
    )
      .bind(id, h.name, h.url, newSecret(), h.mailboxId, h.events.join(","), now())
      .run();
    return ok("Webhook added. Copy the signing secret into your receiver.", { redirect: `/admin/webhooks/${id}` });
  },
]);

export const updateWebhookAction = serverAction([
  adminOnly,
  async (form: FormData): Promise<ActionResult> => {
    const id = text(form, "id");
    const h = readHook(form);
    if ("error" in h) return fail(h.error);
    if (h.mailboxId && !(await mailboxExists(h.mailboxId))) return fail("Pick a mailbox.");
    await env.DB.prepare("UPDATE webhooks SET name = ?, url = ?, mailbox_id = ?, events = ?, active = ? WHERE id = ?")
      .bind(h.name, h.url, h.mailboxId, h.events.join(","), form.get("active") === "on" ? 1 : 0, id)
      .run();
    return ok("Webhook saved.");
  },
]);

const loadHook = (id: string) => env.DB.prepare("SELECT * FROM webhooks WHERE id = ?").bind(id).first<WebhookRow>();

export const testWebhookAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    const hook = await loadHook(id);
    if (!hook) return fail("This webhook no longer exists.");
    return (await sendTestEvent(hook)) ? ok("Test event delivered.") : fail("Test event failed. See the delivery log.");
  },
]);

export const retryDeliveryAction = serverAction([
  adminOnly,
  async (hookId: string, deliveryId: string): Promise<ActionResult> => {
    const hook = await loadHook(hookId);
    const d = await env.DB.prepare("SELECT * FROM webhook_deliveries WHERE id = ? AND webhook_id = ?")
      .bind(deliveryId, hookId)
      .first<DeliveryRow>();
    if (!hook || !d) return fail("This delivery no longer exists.");
    return (await attemptDelivery({ ...d, attempts: 0 }, hook)) ? ok("Delivered.") : fail("Still failing. It's retried automatically.");
  },
]);

export const rotateSecretAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    await env.DB.prepare("UPDATE webhooks SET secret = ? WHERE id = ?").bind(newSecret(), id).run();
    return ok("New secret generated. Update your receiver.");
  },
]);

export const deleteWebhookAction = serverAction([
  adminOnly,
  async (id: string): Promise<ActionResult> => {
    await env.DB.prepare("DELETE FROM webhooks WHERE id = ?").bind(id).run();
    return ok("Webhook deleted.", { redirect: "/admin/api" });
  },
]);
