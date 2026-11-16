import { env } from "cloudflare:workers";
import { sha256 } from "./auth";
import { domainOf, newId, now } from "./util";

/*
 * API keys. A key holds grants; each grant gives read and/or send on every
 * mailbox, on a whole domain (mailboxes added later included) or on one
 * mailbox. A key may do something on a mailbox when any grant covering that
 * mailbox allows it.
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
};

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* ---------- Grants from a form ---------- */

/**
 * Reads the access matrix posted by the key dialog: checkboxes named "read"
 * and "send" whose values are "all", "domain:<id>" or "mailbox:<id>".
 * Unknown domains and mailboxes are dropped.
 */
export async function grantsFromForm(form: FormData): Promise<Grant[]> {
  const read = new Set(form.getAll("read").map(String));
  const send = new Set(form.getAll("send").map(String));
  const [{ results: domains }, { results: mailboxes }] = await Promise.all([
    env.DB.prepare("SELECT id FROM domains").all<{ id: string }>(),
    env.DB.prepare("SELECT id FROM mailboxes").all<{ id: string }>(),
  ]);
  const known = new Set(["all", ...domains.map((d) => `domain:${d.id}`), ...mailboxes.map((m) => `mailbox:${m.id}`)]);
  const grants: Grant[] = [];
  for (const target of new Set([...read, ...send])) {
    if (!known.has(target)) continue;
    const [type, id = ""] = target === "all" ? ["all"] : target.split(":");
    grants.push({ target_type: type as GrantTarget, target_id: id, can_read: read.has(target) ? 1 : 0, can_send: send.has(target) ? 1 : 0 });
  }
  return grants;
}

const grantStatements = (keyId: string, grants: Grant[]) => [
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

/** Grants of every key that isn't revoked (one query, however many keys). */
export async function listActiveGrants(): Promise<(Grant & { key_id: string })[]> {
  const { results } = await env.DB.prepare(
    "SELECT g.* FROM api_key_grants g JOIN api_keys k ON k.id = g.key_id WHERE k.revoked_at IS NULL",
  ).all<Grant & { key_id: string }>();
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

export type ApiAuth = { key: ApiKeyRow; grants: ResolvedGrant[] };
export type Perm = { read: boolean; send: boolean };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export const apiError = (status: number, code: string, message: string) => json(status, { error: { code, message } });
export const apiJson = (body: unknown, status = 200) => json(status, body);

/**
 * Checks the Bearer key. With a scope, the key must hold it on at least one
 * grant; with `null`, any permission will do. Which mailbox it may use is
 * checked per request with `can()`.
 */
export async function authenticate(request: Request, scope: Scope | null): Promise<ApiAuth | Response> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return apiError(401, "unauthorized", "Send your API key as: Authorization: Bearer <key>");
  const key = await env.DB.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(await sha256(token))
    .first<ApiKeyRow>();
  if (!key) return apiError(401, "unauthorized", "Unknown or revoked API key.");
  const { results: grants } = await env.DB.prepare(
    `SELECT g.*, d.name AS domain FROM api_key_grants g
     LEFT JOIN domains d ON g.target_type = 'domain' AND d.id = g.target_id
     WHERE g.key_id = ?`,
  )
    .bind(key.id)
    .all<ResolvedGrant>();
  const auth = { key, grants };
  const holds = (g: Grant) => (scope === "read" ? g.can_read : scope === "send" ? g.can_send : g.can_read || g.can_send);
  if (!grants.some(holds))
    return apiError(403, "forbidden", scope ? `This key has no "${scope}" permission on any mailbox.` : "This key has no permission on any mailbox.");
  // Cheap enough to do on every call; keeps "last used" honest in the admin UI.
  await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now(), key.id).run();
  return auth;
}

/** What the key may do on this mailbox: the union of every grant that covers it. */
export function permFor(auth: ApiAuth, mailbox: { id: string; address: string }): Perm {
  const domain = domainOf(mailbox.address);
  const perm = { read: false, send: false };
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
