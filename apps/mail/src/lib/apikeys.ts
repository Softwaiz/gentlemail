import { env } from "cloudflare:workers";
import { sha256 } from "./auth";
import { ACCESS_PREFIX } from "./oauth";
import { b64url, domainOf, newId, now } from "./util";

/*
 * API keys. A key holds grants; each grant gives read and/or send on every
 * mailbox, on a whole domain (mailboxes added later included) or on one
 * mailbox. A key may do something on a mailbox when any grant covering that
 * mailbox allows it.
 *
 * An assistant connected by signing in (OAuth, see oauth.ts) is a row here
 * too, with user_id set: same grants, but only on mailboxes that person can
 * open, and only with the short-lived tokens it got, on /mcp.
 */

export type Scope = "send" | "read";

export type GrantTarget = "all" | "domain" | "mailbox";
export type Grant = { target_type: GrantTarget; target_id: string; can_read: number; can_send: number };
/** A grant with the domain name resolved, for matching mailboxes by address. */
type ResolvedGrant = Grant & { domain: string | null };

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  /** Set for an assistant connected by signing in: it acts for this person. */
  user_id: string | null;
  client_id: string | null;
};

/* ---------- Grants from a form ---------- */

/**
 * Reads the access matrix posted by the key dialog: checkboxes named "read"
 * and "send" whose values are "all", "domain:<id>" or "mailbox:<id>".
 * Unknown domains and mailboxes are dropped, and so is anything outside
 * `allowed` when given (the lines a person may grant an assistant).
 */
export async function grantsFromForm(form: FormData, allowed?: Set<string>): Promise<Grant[]> {
  const read = new Set(form.getAll("read").map(String));
  const send = new Set(form.getAll("send").map(String));
  let known = allowed;
  if (!known) {
    const [{ results: domains }, { results: mailboxes }] = await Promise.all([
      env.DB.prepare("SELECT id FROM domains").all<{ id: string }>(),
      env.DB.prepare("SELECT id FROM mailboxes").all<{ id: string }>(),
    ]);
    known = new Set(["all", ...domains.map((d) => `domain:${d.id}`), ...mailboxes.map((m) => `mailbox:${m.id}`)]);
  }
  const grants: Grant[] = [];
  for (const target of new Set([...read, ...send])) {
    if (!known.has(target)) continue;
    const [type, id = ""] = target === "all" ? ["all"] : target.split(":");
    grants.push({ target_type: type as GrantTarget, target_id: id, can_read: read.has(target) ? 1 : 0, can_send: send.has(target) ? 1 : 0 });
  }
  return grants;
}

/** Replaces a key's grants (statements for a batch). */
export const grantStatements = (keyId: string, grants: Grant[]) => [
  env.DB.prepare("DELETE FROM api_key_grants WHERE key_id = ?").bind(keyId),
  ...grants.map((g) =>
    env.DB.prepare("INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_send) VALUES (?, ?, ?, ?, ?)").bind(
      keyId,
      g.target_type,
      g.target_id,
      g.can_read,
      g.can_send,
    ),
  ),
];

/** Creates a key and returns the plain value. It is shown once and only its hash is stored. */
export async function createApiKey(input: { name: string; grants: Grant[]; userId: string }) {
  const key = `gm_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const id = newId();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO api_keys (id, name, prefix, key_hash, mailbox_id, scopes, created_by, created_at)
       VALUES (?, ?, ?, ?, NULL, '', ?, ?)`,
    ).bind(id, input.name, key.slice(0, 10), await sha256(key), input.userId, now()),
    ...grantStatements(id, input.grants),
  ]);
  return { id, key };
}

/**
 * Replaces a key's grants; the key itself is unchanged. Also clears the legacy
 * api_keys.mailbox_id, whose ON DELETE CASCADE would otherwise delete the key
 * along with that mailbox.
 */
export async function setApiKeyGrants(keyId: string, grants: Grant[]) {
  await env.DB.batch([
    env.DB.prepare("UPDATE api_keys SET mailbox_id = NULL WHERE id = ?").bind(keyId),
    ...grantStatements(keyId, grants),
  ]);
}

/** Grants of every live key, or of every live assistant connection, or of one person's (one query, however many). */
export async function listActiveGrants(kind: "keys" | "connections" = "keys", userId?: string): Promise<(Grant & { key_id: string })[]> {
  const { results } = await env.DB.prepare(
    `SELECT g.* FROM api_key_grants g JOIN api_keys k ON k.id = g.key_id
     WHERE k.revoked_at IS NULL AND k.user_id IS ${kind === "keys" ? "NULL" : "NOT NULL"} ${userId ? "AND k.user_id = ?" : ""}`,
  )
    .bind(...(userId ? [userId] : []))
    .all<Grant & { key_id: string }>();
  return results;
}

export type Connection = ApiKeyRow & { user_email: string };

/** Assistants connected by signing in: one person's, or everyone's (admin). */
export async function listConnections(userId?: string) {
  const { results } = await env.DB.prepare(
    `SELECT k.*, u.email AS user_email FROM api_keys k JOIN users u ON u.id = k.user_id
     WHERE k.revoked_at IS NULL ${userId ? "AND k.user_id = ?" : ""} ORDER BY k.created_at DESC`,
  )
    .bind(...(userId ? [userId] : []))
    .all<Connection>();
  return results;
}

/**
 * SQL condition: grant `g` covers mailbox `b`. The same rule as permFor():
 * every mailbox, that mailbox, or a mailbox whose address ends in "@<domain>".
 */
export const GRANT_COVERS_SQL = `(g.target_type = 'all'
  OR (g.target_type = 'mailbox' AND g.target_id = b.id)
  OR (g.target_type = 'domain' AND EXISTS (
    SELECT 1 FROM domains d WHERE d.id = g.target_id
      AND substr(lower(b.address), -length(d.name) - 1) = '@' || lower(d.name))))`;

/* ---------- Checking a request ---------- */

/**
 * `limit`: for an assistant acting for someone who isn't an admin, the ids of
 * the mailboxes that person can open now. Its grants count only there. Null for
 * API keys and admins' assistants.
 */
export type ApiAuth = {
  key: ApiKeyRow;
  grants: ResolvedGrant[];
  limit: Set<string> | null;
  /** Whether it may read and send on at least one mailbox it can reach now (decides which MCP tools it sees). */
  can: Perm;
};
export type Perm = { read: boolean; send: boolean };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export const apiError = (status: number, code: string, message: string) => json(status, { error: { code, message } });
export const apiJson = (body: unknown, status = 200) => json(status, body);

/**
 * An assistant's token: its connection, and the mailboxes its person can open
 * now (null for an admin). Access lost and given back again counts at once,
 * since nothing is deleted.
 */
async function connectionFor(token: string): Promise<{ key: ApiKeyRow; limit: Set<string> | null } | Response> {
  const row = await env.DB.prepare(
    `SELECT k.*, u.role AS user_role,
       u.mfa_enabled_at IS NULL AND EXISTS (SELECT 1 FROM settings WHERE key = 'require_mfa' AND value = '1') AS needs_mfa
     FROM oauth_tokens t JOIN api_keys k ON k.id = t.key_id JOIN users u ON u.id = k.user_id
     WHERE t.id = ? AND t.kind = 'access' AND t.expires_at > ? AND k.revoked_at IS NULL`,
  )
    .bind(await sha256(token), now())
    .first<ApiKeyRow & { user_role: string; needs_mfa: number }>();
  if (!row) return apiError(401, "invalid_token", "This token is unknown, expired or disconnected. Sign in again.");
  if (row.needs_mfa)
    return apiError(403, "mfa_required", "Your admin requires two-step verification. Set it up in the webmail, then try again.");
  const { needs_mfa: _, user_role, ...key } = row;
  if (user_role === "admin") return { key, limit: null };
  const { results } = await env.DB.prepare("SELECT mailbox_id FROM mailbox_members WHERE user_id = ?")
    .bind(key.user_id)
    .all<{ mailbox_id: string }>();
  return { key, limit: new Set(results.map((r) => r.mailbox_id)) };
}

/**
 * SQL to add after GRANT_COVERS_SQL (mailbox `b`): keeps an assistant to the
 * mailboxes its person can open, as `limit` does in permFor().
 */
export function limitSql(auth: Pick<ApiAuth, "limit">): { sql: string; binds: unknown[] } {
  if (!auth.limit) return { sql: "", binds: [] };
  return { sql: " AND b.id IN (SELECT value FROM json_each(?))", binds: [JSON.stringify([...auth.limit])] };
}

/** Ends every assistant connection of this person (statement for a batch): their password or two-step was reset. */
export const endConnections = (userId: string) => env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(userId);

/**
 * Checks the Bearer key. With a scope, the key must hold it on at least one
 * grant; with `null`, any permission will do. Which mailbox it may use is
 * checked per request with `can()`. Tokens from signing in (OAuth) are
 * accepted only where `oauth` is set: they are for /mcp.
 */
export async function authenticate(request: Request, scope: Scope | null, opts: { oauth?: boolean } = {}): Promise<ApiAuth | Response> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return apiError(401, "unauthorized", "Send your API key as: Authorization: Bearer <key>");
  let key: ApiKeyRow | null;
  let limit: Set<string> | null = null;
  if (token.startsWith(ACCESS_PREFIX)) {
    if (!opts.oauth) return apiError(401, "unauthorized", "Tokens from signing in work on /mcp only. Use an API key here.");
    const found = await connectionFor(token);
    if (found instanceof Response) return found;
    ({ key, limit } = found);
  } else {
    key = await env.DB.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL AND user_id IS NULL")
      .bind(await sha256(token))
      .first<ApiKeyRow>();
  }
  if (!key) return apiError(401, "unauthorized", "Unknown or revoked API key.");
  const { results: grants } = await env.DB.prepare(
    `SELECT g.*, d.name AS domain FROM api_key_grants g
     LEFT JOIN domains d ON g.target_type = 'domain' AND d.id = g.target_id
     WHERE g.key_id = ?`,
  )
    .bind(key.id)
    .all<ResolvedGrant>();
  let can: Perm = { read: grants.some((g) => !!g.can_read), send: grants.some((g) => !!g.can_send) };
  if (limit) {
    // An assistant: what its grants allow on the mailboxes its person can still open.
    const l = limitSql({ limit });
    const row = await env.DB.prepare(
      `SELECT MAX(g.can_read) AS r, MAX(g.can_send) AS s FROM mailboxes b JOIN api_key_grants g ON g.key_id = ? AND ${GRANT_COVERS_SQL}${l.sql}`,
    )
      .bind(key.id, ...l.binds)
      .first<{ r: number | null; s: number | null }>();
    can = { read: !!row?.r, send: !!row?.s };
    // Signing in again lets the person pick from the mailboxes they have now.
    if (!can.read && !can.send)
      return apiError(401, "invalid_token", "None of the mailboxes this assistant was given can be opened by you any more. Sign in again to choose others.");
  }
  const auth: ApiAuth = { key, grants, limit, can };
  if (!(scope ? can[scope] : can.read || can.send))
    return apiError(403, "forbidden", scope ? `This key has no "${scope}" permission on any mailbox.` : "This key has no permission on any mailbox.");
  // Cheap enough to do on every call; keeps "last used" honest in the admin UI.
  await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now(), key.id).run();
  return auth;
}

/** What the key may do on this mailbox: the union of every grant that covers it. */
export function permFor(auth: ApiAuth, mailbox: { id: string; address: string }): Perm {
  const domain = domainOf(mailbox.address);
  const perm = { read: false, send: false };
  if (auth.limit && !auth.limit.has(mailbox.id)) return perm;
  for (const g of auth.grants) {
    const covers =
      g.target_type === "all" ||
      (g.target_type === "mailbox" && g.target_id === mailbox.id) ||
      (g.target_type === "domain" && g.domain?.toLowerCase() === domain);
    if (!covers) continue;
    perm.read ||= !!g.can_read;
    perm.send ||= !!g.can_send;
  }
  return perm;
}

export const can = (auth: ApiAuth, mailbox: { id: string; address: string }, scope: Scope) => permFor(auth, mailbox)[scope];
