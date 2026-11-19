import { env, waitUntil } from "cloudflare:workers";
import { sha256 } from "./auth";
import { ACCESS_PREFIX } from "./token-prefixes";
import { b64url, domainOf, json, newId, now } from "./util";

/*
 * API keys. A key holds grants; each grant gives read, organize and/or send
 * on every mailbox, on a whole domain (mailboxes added later included) or on
 * one mailbox. Organize is marking and moving messages (read/unread, star,
 * archive, spam, trash, inbox). A key may do something on a mailbox when any grant covering that
 * mailbox allows it.
 *
 * An assistant connected by signing in (OAuth, see oauth.ts) is a row here
 * too, with user_id set: same grants, but only on mailboxes that person can
 * open, and only with the short-lived tokens it got, on /mcp.
 */

export type Scope = "read" | "organize" | "send";
export const SCOPES: Scope[] = ["read", "organize", "send"];

export type GrantTarget = "all" | "domain" | "mailbox";
export type Grant = { target_type: GrantTarget; target_id: string; can_read: number; can_organize: number; can_send: number };
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
 * Reads the access matrix posted by the key dialog: checkboxes named "read",
 * "organize" and "send" whose values are "all", "domain:<id>" or "mailbox:<id>".
 * Unknown domains and mailboxes are dropped, and so is anything outside
 * `allowed` when given (the lines a person may grant an assistant).
 */
export async function grantsFromForm(form: FormData, allowed?: Set<string>): Promise<Grant[]> {
  const read = new Set(form.getAll("read").map(String));
  const organize = new Set(form.getAll("organize").map(String));
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
  for (const target of new Set([...read, ...organize, ...send])) {
    if (!known.has(target)) continue;
    const [type, id = ""] = target === "all" ? ["all"] : target.split(":");
    grants.push({
      target_type: type as GrantTarget,
      target_id: id,
      can_read: read.has(target) ? 1 : 0,
      can_organize: organize.has(target) ? 1 : 0,
      can_send: send.has(target) ? 1 : 0,
    });
  }
  return grants;
}

/** Replaces a key's grants (statements for a batch). */
export const grantStatements = (keyId: string, grants: Grant[]) => [
  env.DB.prepare("DELETE FROM api_key_grants WHERE key_id = ?").bind(keyId),
  ...grants.map((g) =>
    env.DB.prepare(
      "INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_organize, can_send) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(keyId, g.target_type, g.target_id, g.can_read, g.can_organize, g.can_send),
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
  /** Whether it may read, organize and send on at least one mailbox it can reach now (decides which MCP tools it sees). */
  can: Perm;
};
export type Perm = Record<Scope, boolean>;

/** SQL condition: grant `g` allows something. */
const GRANT_ALLOWS_SQL = "(g.can_read = 1 OR g.can_organize = 1 OR g.can_send = 1)";

export const apiError = (status: number, code: string, message: string) => json({ error: { code, message } }, status);
export const apiJson = (body: unknown, status = 200) => json(body, status);

/**
 * An assistant's token: its connection, and whether it acts for an admin.
 * Access lost and given back again counts at once, since nothing is deleted.
 */
async function connectionFor(token: string): Promise<{ key: ApiKeyRow; admin: boolean } | Response> {
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
  return { key, admin: user_role === "admin" };
}

/** The mailboxes a person can open (SQL; `user` is a bind or a column). */
const memberMailboxesSql = (user = "?") => `SELECT mailbox_id FROM mailbox_members WHERE user_id = ${user}`;

/**
 * SQL for a FROM clause: mailboxes `b`, each with the grants `g` of key `key`
 * that cover it; with `user`, only the mailboxes that person can open, as
 * `limit` does in permFor(). Every query of what a key or an assistant reaches
 * goes through here (`key` and `user` are binds or columns).
 */
const coveredSql = (key: string, user: string | null) =>
  `mailboxes b JOIN api_key_grants g ON g.key_id = ${key} AND ${GRANT_COVERS_SQL}${user ? ` AND b.id IN (${memberMailboxesSql(user)})` : ""}`;

/** coveredSql() for this key or assistant, with its binds. */
export function coveredMailboxes(auth: Pick<ApiAuth, "limit" | "key">): { sql: string; binds: unknown[] } {
  return auth.limit ? { sql: coveredSql("?", "?"), binds: [auth.key.id, auth.key.user_id] } : { sql: coveredSql("?", null), binds: [auth.key.id] };
}

/**
 * SQL condition: connection `k` may still do something on a mailbox its person
 * can open (any, for an admin). The same rule authenticate() applies; a
 * connection without it can't refresh its tokens, so its app signs in again.
 */
export const CONNECTION_REACHES_SQL = `CASE WHEN (SELECT role FROM users WHERE id = k.user_id) = 'admin'
  THEN EXISTS (SELECT 1 FROM api_key_grants g WHERE g.key_id = k.id AND ${GRANT_ALLOWS_SQL})
  ELSE EXISTS (SELECT 1 FROM ${coveredSql("k.id", "k.user_id")} WHERE ${GRANT_ALLOWS_SQL}) END`;

/**
 * SQL condition: connection `k` may be used now: it reaches a mailbox, and its
 * person isn't held back by required two-step verification they haven't set up.
 */
export const CONNECTION_USABLE_SQL = `${CONNECTION_REACHES_SQL} AND NOT EXISTS (
  SELECT 1 FROM users u WHERE u.id = k.user_id AND u.mfa_enabled_at IS NULL
    AND EXISTS (SELECT 1 FROM settings WHERE key = 'require_mfa' AND value = '1'))`;

/**
 * Ends every assistant connection of this person, and sign-ins not yet traded
 * for tokens (statements for a batch): their password or two-step was reset.
 */
export const endConnections = (userId: string) => [
  env.DB.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(userId),
  env.DB.prepare("DELETE FROM oauth_codes WHERE user_id = ?").bind(userId),
];

/**
 * Checks the Bearer key. With a scope, the key must hold it on at least one
 * grant; with `null`, any permission will do. Which mailbox it may use is
 * checked per request with `can()`. Tokens from signing in (OAuth) are
 * accepted only where `oauth` is set: they are for /mcp.
 *
 * Two round trips: the key, then one batch with its grants and its person's
 * mailboxes. "Last used" is written after the answer, for accepted calls only.
 */
export async function authenticate(request: Request, scope: Scope | null, opts: { oauth?: boolean } = {}): Promise<ApiAuth | Response> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return apiError(401, "unauthorized", "Send your API key as: Authorization: Bearer <key>");
  let key: ApiKeyRow | null;
  let limited = false;
  if (token.startsWith(ACCESS_PREFIX)) {
    if (!opts.oauth) return apiError(401, "unauthorized", "Tokens from signing in work on /mcp only. Use an API key here.");
    const found = await connectionFor(token);
    if (found instanceof Response) return found;
    key = found.key;
    limited = !found.admin;
  } else {
    key = await env.DB.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL AND user_id IS NULL")
      .bind(await sha256(token))
      .first<ApiKeyRow>();
  }
  if (!key) return apiError(401, "unauthorized", "Unknown or revoked API key.");
  const grantsQuery = env.DB.prepare(
    `SELECT g.*, d.name AS domain FROM api_key_grants g
     LEFT JOIN domains d ON g.target_type = 'domain' AND d.id = g.target_id
     WHERE g.key_id = ?`,
  ).bind(key.id);
  const [grantRows, memberRows, reachRows] = await env.DB.batch(
    limited
      ? [
          grantsQuery,
          env.DB.prepare(memberMailboxesSql()).bind(key.user_id),
          // An assistant: what its grants allow on the mailboxes its person can still open.
          env.DB.prepare(
            `SELECT MAX(g.can_read) AS r, MAX(g.can_organize) AS o, MAX(g.can_send) AS s FROM ${coveredSql("?", "?")}`,
          ).bind(key.id, key.user_id),
        ]
      : [grantsQuery],
  );
  const grants = grantRows.results as ResolvedGrant[];
  const limit = memberRows ? new Set((memberRows.results as { mailbox_id: string }[]).map((r) => r.mailbox_id)) : null;
  let can: Perm = {
    read: grants.some((g) => !!g.can_read),
    organize: grants.some((g) => !!g.can_organize),
    send: grants.some((g) => !!g.can_send),
  };
  if (limit) {
    const reach = reachRows?.results[0] as { r: number | null; o: number | null; s: number | null } | undefined;
    can = { read: !!reach?.r, organize: !!reach?.o, send: !!reach?.s };
  }
  const anything = can.read || can.organize || can.send;
  // An assistant (an admin's too) with nothing left: signing in again lets the person pick
  // from the mailboxes they have now (refreshing fails too), so it's a 401, not a 403.
  if (key.user_id && !anything)
    return apiError(401, "invalid_token", "None of the mailboxes this assistant was given can be opened by you any more. Sign in again to choose others.");
  const auth: ApiAuth = { key, grants, limit, can };
  if (!(scope ? can[scope] : anything))
    return apiError(403, "forbidden", scope ? `This key has no "${scope}" permission on any mailbox.` : "This key has no permission on any mailbox.");
  waitUntil(
    env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .bind(now(), key.id)
      .run()
      .catch((e) => console.error("last_used_at update failed", e)),
  );
  return auth;
}

/** What the key may do on this mailbox: the union of every grant that covers it. */
export function permFor(auth: ApiAuth, mailbox: { id: string; address: string }): Perm {
  const domain = domainOf(mailbox.address);
  const perm: Perm = { read: false, organize: false, send: false };
  if (auth.limit && !auth.limit.has(mailbox.id)) return perm;
  for (const g of auth.grants) {
    const covers =
      g.target_type === "all" ||
      (g.target_type === "mailbox" && g.target_id === mailbox.id) ||
      (g.target_type === "domain" && g.domain?.toLowerCase() === domain);
    if (!covers) continue;
    perm.read ||= !!g.can_read;
    perm.organize ||= !!g.can_organize;
    perm.send ||= !!g.can_send;
  }
  return perm;
}

export const can = (auth: ApiAuth, mailbox: { id: string; address: string }, scope: Scope) => permFor(auth, mailbox)[scope];
