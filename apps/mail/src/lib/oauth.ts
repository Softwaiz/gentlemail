import { env } from "cloudflare:workers";
import { sha256 } from "./auth";
import { CONNECTION_USABLE_SQL, type Grant } from "./apikeys";
import { ACCESS_PREFIX, CODE_PREFIX, REFRESH_PREFIX } from "./token-prefixes";
import { b64url, newId, now } from "./util";

/*
 * The OAuth 2.1 authorization server behind /mcp, kept in D1.
 *
 * An assistant registers itself (Dynamic Client Registration), sends the person
 * to /oauth/authorize, where they sign in and choose what it may read, organize
 * and send, then trades the code for tokens (PKCE, S256 only). What it gets is a
 * connection: an api_keys row with user_id set, so the same grants and checks
 * as API keys apply, limited to what that person can open (see authenticate()).
 *
 * Access tokens last an hour; refresh tokens 60 days, and each use replaces
 * the refresh token. Only SHA-256 hashes of codes, tokens and client secrets
 * are stored.
 */

export const ACCESS_TTL = 60 * 60 * 1000;
export const REFRESH_TTL = 60 * 24 * 60 * 60 * 1000;
const CODE_TTL = 5 * 60 * 1000;
/** Registered apps that never connected are removed after a day; others a year after their last sign-in, once disconnected. */
const UNUSED_CLIENT_TTL = 24 * 60 * 60 * 1000;
const IDLE_CLIENT_TTL = 365 * 24 * 60 * 60 * 1000;
export const SCOPE = "mail";
/**
 * Registered apps that haven't signed in yet, kept at most by the hourly purge
 * (each holds up to about 3 KB). Those registered in the last 15 minutes are
 * always kept: their person may be on the sign-in or consent page.
 */
const MAX_PENDING_CLIENTS = 5000;
const PENDING_CLIENT_KEEP = 15 * 60 * 1000;

export type OAuthClient = { id: string; name: string; redirect_uris: string; secret_hash: string | null; created_at: number; used_at: number | null };
export type TokenSet = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };
/** An OAuth error, as the token and registration endpoints return it (RFC 6749 §5.2). */
export type OAuthError = { error: string; error_description: string; status?: number };

const randomToken = (prefix: string) => prefix + b64url(crypto.getRandomValues(new Uint8Array(32)));
const oauthError = (error: string, error_description: string, status = 400): OAuthError => ({ error, error_description, status });

/* ---------- Redirect URIs ---------- */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const isLoopback = (u: URL) => u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
// Schemes that could run code or read files if a browser were sent there.
const UNSAFE_SCHEMES = new Set(["javascript:", "data:", "file:", "blob:", "vbscript:", "about:", "filesystem:", "ws:", "wss:"]);

/**
 * Where an app may ask to be sent back: https, http on this computer (desktop apps
 * and CLIs listen on a local port), or an app's own scheme such as cursor://.
 */
export function redirectUriProblem(uri: string): string | null {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return `${uri} isn't a valid URL.`;
  }
  if (u.hash) return "Redirect URIs can't have a #fragment.";
  if (u.protocol === "https:" || isLoopback(u)) return null;
  if (u.protocol === "http:") return "Use https, or http only on localhost / 127.0.0.1.";
  if (UNSAFE_SCHEMES.has(u.protocol)) return `${u.protocol} redirect URIs aren't allowed.`;
  return null;
}

/** Exact match; on localhost any port, since a CLI picks a free port each time (RFC 8252 §7.3). */
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (!isLoopback(u)) return false;
  return registered.some((r) => {
    try {
      const x = new URL(r);
      return isLoopback(x) && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search;
    } catch {
      return false;
    }
  });
}

export const clientRedirectUris = (c: OAuthClient): string[] => {
  try {
    return JSON.parse(c.redirect_uris);
  } catch {
    return [];
  }
};

/* ---------- Clients ---------- */

/** How a client may authenticate at the token and revocation endpoints (also listed in the server metadata). */
export const AUTH_METHODS = ["none", "client_secret_post", "client_secret_basic"];

/**
 * POST /oauth/register (RFC 7591). Open to anyone: it only lets an app ask; the
 * person decides. Limited per address by REGISTER_LIMIT, when the Worker has it.
 */
export async function registerClient(body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every((u) => typeof u === "string" && u.length <= 500))
    return oauthError("invalid_redirect_uri", "Send redirect_uris: one to five URLs of up to 500 characters.");
  for (const u of uris as string[]) {
    const problem = redirectUriProblem(u);
    if (problem) return oauthError("invalid_redirect_uri", problem);
  }
  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!AUTH_METHODS.includes(method)) return oauthError("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.");
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code", "refresh_token"];
  if (!grantTypes.includes("authorization_code")) return oauthError("invalid_client_metadata", "grant_types must include authorization_code.");

  // Control and format characters (direction overrides, zero-width ones) could make a name show as another,
  // and fillers (U+3164 and the like) as blank: dropped. Cut by character, so an emoji isn't cut in half.
  const raw = typeof body.client_name === "string" ? body.client_name : "";
  const cleaned = raw.replace(/[\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu, "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim();
  const short = Array.from(cleaned).slice(0, 80).join("").trim();
  const name = /[\p{L}\p{N}\p{P}\p{S}]/u.test(short) ? short : "An unnamed app";
  const id = `gmcl_${b64url(crypto.getRandomValues(new Uint8Array(16)))}`;
  const secret = method === "none" ? null : randomToken("gmcs_");
  const created = now();
  await env.DB.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, name, JSON.stringify(uris), secret ? await sha256(secret) : null, created)
    .run();
  return {
    client_id: id,
    client_id_issued_at: Math.floor(created / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: name,
    redirect_uris: uris as string[],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: method,
    scope: SCOPE,
  };
}

export const getClient = (id: string) => env.DB.prepare("SELECT * FROM oauth_clients WHERE id = ?").bind(id).first<OAuthClient>();

/**
 * The client calling the token or revocation endpoint: client_id in the form or
 * HTTP Basic, and its secret when it registered with one.
 */
export async function authenticateClient(request: Request, form: FormData): Promise<OAuthClient | OAuthError> {
  let id = String(form.get("client_id") ?? "");
  let secret = form.get("client_secret") == null ? null : String(form.get("client_secret"));
  const basic = request.headers.get("Authorization");
  if (basic?.startsWith("Basic ")) {
    try {
      const pair = atob(basic.slice(6));
      const colon = pair.indexOf(":");
      id = decodeURIComponent(colon < 0 ? pair : pair.slice(0, colon));
      secret = colon < 0 ? "" : decodeURIComponent(pair.slice(colon + 1));
    } catch {
      return oauthError("invalid_client", "Malformed Basic credentials.", 401);
    }
  }
  const client = id ? await getClient(id) : null;
  if (!client) return oauthError("invalid_client", "Unknown client. Register again.", 401);
  if (client.secret_hash && (secret == null || (await sha256(secret)) !== client.secret_hash))
    return oauthError("invalid_client", "Wrong client secret.", 401);
  return client;
}

/* ---------- Codes and tokens ---------- */

/** The person allowed it: a single-use code for the app to trade for tokens. */
/** `redirectUri`: as the app sent it to /oauth/authorize, or null if it left it out (it then needn't repeat it). */
export async function createCode(input: { clientId: string; userId: string; redirectUri: string | null; challenge: string; grants: Grant[] }) {
  const code = randomToken(CODE_PREFIX);
  await env.DB.prepare(
    "INSERT INTO oauth_codes (id, client_id, user_id, redirect_uri, code_challenge, grants, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(await sha256(code), input.clientId, input.userId, input.redirectUri, input.challenge, JSON.stringify(input.grants), now() + CODE_TTL)
    .run();
  return code;
}

async function s256(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** A fresh pair: the tokens to give out, and the hashes to store. */
async function newPair() {
  const access = randomToken(ACCESS_PREFIX);
  const refresh = randomToken(REFRESH_PREFIX);
  const set: TokenSet = { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: SCOPE };
  return { set, accessId: await sha256(access), refreshId: await sha256(refresh) };
}

/** grant_type=authorization_code: checks the code, PKCE and redirect URI, then connects the app. */
export async function exchangeCode(client: OAuthClient, form: FormData): Promise<TokenSet | OAuthError> {
  const code = String(form.get("code") ?? "");
  const verifier = String(form.get("code_verifier") ?? "");
  if (!code || !verifier) return oauthError("invalid_request", "Send code and code_verifier.");
  // Claimed as it is read (its challenge emptied), so a code works once even if
  // two requests race. A claimed code is kept a minute longer, so the hourly
  // clean-up can't remove it mid-exchange; it is deleted below, in the batch that
  // makes the connection.
  const codeId = await sha256(code);
  const t = now();
  const invalid = oauthError("invalid_grant", "This code is unknown, used or expired. Sign in again.");
  const row = await env.DB.prepare("SELECT * FROM oauth_codes WHERE id = ? AND code_challenge != '' AND expires_at >= ?")
    .bind(codeId, t)
    .first<{ client_id: string; user_id: string; redirect_uri: string | null; code_challenge: string; grants: string }>();
  if (!row) return invalid;
  const claim = await env.DB.prepare("UPDATE oauth_codes SET code_challenge = '', expires_at = ? WHERE id = ? AND code_challenge = ?")
    .bind(t + 60_000, codeId, row.code_challenge)
    .run();
  if (!claim.meta.changes || row.client_id !== client.id) return invalid;
  // RFC 6749 §4.1.3: sent to /oauth/authorize, so it must be sent here too, the same. Left out
  // there, it may still be sent here (many libraries always do): then it's one the app registered.
  const redirectUri = form.get("redirect_uri");
  const sent = redirectUri == null ? null : String(redirectUri);
  if (row.redirect_uri != null ? sent !== row.redirect_uri : sent != null && !clientRedirectUris(client).includes(sent))
    return oauthError("invalid_grant", "redirect_uri doesn't match the one used to sign in.");
  if ((await s256(verifier)) !== row.code_challenge) return oauthError("invalid_grant", "code_verifier doesn't match the code_challenge.");

  const grants: Grant[] = JSON.parse(row.grants);
  const family = newId();
  const { set, accessId, refreshId } = await newPair();
  // One batch (a transaction), each step only while the code is still there: a
  // Disconnect, which deletes the code, comes either before (nothing is made)
  // or after (it removes all of it), never in between.
  const codeLive = "EXISTS (SELECT 1 FROM oauth_codes WHERE id = ?)";
  // One connection per person and app (a unique index): signing in again, from
  // any device, replaces its access and keeps the tokens other devices hold.
  // Found by person and app in each statement, whether it was there or just made.
  const keyOf = "(SELECT id FROM api_keys WHERE user_id = ? AND client_id = ?)";
  const of = [row.user_id, client.id];
  const token = (id: string, kind: string, ttl: number) =>
    env.DB.prepare(`INSERT INTO oauth_tokens (id, key_id, family, kind, expires_at, created_at) SELECT ?, ${keyOf}, ?, ?, ?, ? WHERE ${codeLive}`)
      .bind(id, ...of, family, kind, t + ttl, t, codeId);
  let results: D1Result[];
  try {
    results = await env.DB.batch([
    // Signing in counts as using it: set in the same statement, so the hourly
    // purge can't remove a dormant connection while it's being taken up again.
    env.DB.prepare(
      `INSERT INTO api_keys (id, name, prefix, key_hash, mailbox_id, scopes, created_by, created_at, user_id, client_id, last_used_at)
       SELECT ?1, ?2, 'oauth', 'oauth:' || ?1, NULL, '', ?3, ?4, ?3, ?5, ?4 WHERE EXISTS (SELECT 1 FROM oauth_codes WHERE id = ?6)
       ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO UPDATE SET last_used_at = excluded.last_used_at`,
    ).bind(newId(), client.name, row.user_id, t, client.id, codeId),
    env.DB.prepare(`DELETE FROM api_key_grants WHERE key_id = ${keyOf} AND ${codeLive}`).bind(...of, codeId),
    ...grants.map((g) =>
      // `?? 0`: a sign-in started before organize existed has no such field.
      env.DB.prepare(
        `INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_organize, can_send) SELECT ${keyOf}, ?, ?, ?, ?, ? WHERE ${codeLive}`,
      ).bind(...of, g.target_type, g.target_id, g.can_read, g.can_organize ?? 0, g.can_send, codeId),
    ),
    token(accessId, "access", ACCESS_TTL),
    token(refreshId, "refresh", REFRESH_TTL),
    env.DB.prepare(`UPDATE oauth_clients SET used_at = ? WHERE id = ? AND ${codeLive}`).bind(t, client.id, codeId),
    env.DB.prepare("DELETE FROM oauth_codes WHERE id = ?").bind(codeId),
    ]);
  } catch (e) {
    // The app gets an OAuth error it can show, not a bare 500 page. Its code is spent: the person signs in again.
    console.error("oauth connection failed", e);
    return oauthError("server_error", "Couldn't save the connection. Sign in again.", 500);
  }
  if (!results.at(-1)!.meta.changes) return oauthError("invalid_grant", "This sign-in was cancelled. Sign in again.");
  return set;
}

/**
 * A refresh token traded in again within this long of its first use is a client
 * retrying (two tabs, an answer lost on the way): it gets back the same pair as
 * the first time, so the device stays one chain with one pair. Only while that
 * pair's refresh token is unused: once the device has gone on with it, the old
 * token coming back is a copy. Any later use is a copy too.
 */
const REUSE_GRACE = 30 * 1000;
/** How long a used refresh token is remembered: a copy used later than that is just unknown. */
const USED_REFRESH_TTL = 7 * 24 * 60 * 60 * 1000;

/*
 * The answer to a refresh is kept on the used token for a retry, encrypted
 * (AES-GCM) with a key derived from that token. Only its hash is stored, so the
 * database alone can't read it: only the token's holder can.
 */
const answerKey = async (token: string) =>
  crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gentlemail retry:${token}`)), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function sealAnswer(token: string, set: TokenSet) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await answerKey(token), new TextEncoder().encode(JSON.stringify(set)));
  return `${b64url(iv)}.${b64url(new Uint8Array(data))}`;
}

async function openAnswer(token: string, sealed: string): Promise<TokenSet | null> {
  try {
    const [iv, data] = sealed.split(".").map(fromB64url);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await answerKey(token), data);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

/**
 * grant_type=refresh_token: a new pair in the same family; the token used is
 * marked used, not deleted. If it comes back other than as a retry (above),
 * someone has a copy: the whole family is signed out (OAuth 2.1 §4.3.1), and
 * its owner signs in again. A connection that can't reach any mailbox any more,
 * or whose person must first set up required two-step verification, can't
 * refresh either, so its app signs in again rather than retrying forever; its
 * token stays valid in case that changes.
 *
 * The first use is one batch (a transaction): a second request with the same
 * token sees either nothing done or everything done, never a used token
 * without its answer.
 */
export async function refreshTokens(client: OAuthClient, form: FormData): Promise<TokenSet | OAuthError> {
  const token = String(form.get("refresh_token") ?? "");
  const unknown = oauthError("invalid_grant", "This refresh token is unknown, used or expired. Sign in again.");
  if (!token.startsWith(REFRESH_PREFIX)) return unknown;
  const id = await sha256(token);
  const { set, accessId, refreshId } = await newPair();
  const sealed = await sealAnswer(token, set);
  const t = now();
  const usable = `key_id IN (SELECT k.id FROM api_keys k WHERE k.client_id = ?3 AND k.revoked_at IS NULL AND ${CONNECTION_USABLE_SQL})`;
  // A new token in the used one's family: ?1 now, ?2 the token used, ?3 the client; ?4–?6 the new token.
  const insert = (tokenId: string, kind: string, ttl: number) =>
    env.DB.prepare(
      `INSERT INTO oauth_tokens (id, key_id, family, kind, expires_at, created_at)
       SELECT ?4, key_id, family, ?5, ?1 + ?6, ?1 FROM oauth_tokens
       WHERE id = ?2 AND kind = 'refresh' AND expires_at > ?1 AND used_at IS NULL AND ${usable}`,
    ).bind(t, id, client.id, tokenId, kind, ttl);
  const [, issued] = await env.DB.batch([
    insert(accessId, "access", ACCESS_TTL),
    insert(refreshId, "refresh", REFRESH_TTL),
    // The family's older access tokens go: this device has a new one.
    env.DB.prepare(
      `DELETE FROM oauth_tokens WHERE kind = 'access' AND id != ?1 AND family = (SELECT family FROM oauth_tokens WHERE id = ?2)
       AND (SELECT used_at FROM oauth_tokens WHERE id = ?3) IS NULL`,
    ).bind(accessId, refreshId, id),
    env.DB.prepare("UPDATE oauth_tokens SET used_at = ?, answer = ? WHERE id = ? AND EXISTS (SELECT 1 FROM oauth_tokens WHERE id = ?)").bind(
      t,
      sealed,
      id,
      refreshId,
    ),
  ]);
  if (issued.meta.changes) return set;

  // Used already. A retry gets the same answer, while the device hasn't gone on with it.
  const used = await env.DB.prepare(
    `SELECT family, used_at, answer, ${usable} AS usable FROM oauth_tokens WHERE id = ?2 AND kind = 'refresh' AND used_at IS NOT NULL
     AND key_id IN (SELECT id FROM api_keys WHERE client_id = ?3)`,
  )
    .bind(t, id, client.id)
    .first<{ family: string; used_at: number; answer: string | null; usable: number }>();
  if (!used) return unknown;
  if (used.used_at >= t - REUSE_GRACE && used.answer) {
    const first = await openAnswer(token, used.answer);
    const live =
      first &&
      (await env.DB.prepare(
        `SELECT 1 FROM oauth_tokens r JOIN oauth_tokens a ON a.id = ?2 AND a.kind = 'access' AND a.family = r.family
         WHERE r.id = ?1 AND r.kind = 'refresh' AND r.used_at IS NULL`,
      )
        .bind(await sha256(first.refresh_token), await sha256(first.access_token))
        .first());
    if (live) return used.usable ? { ...first!, expires_in: Math.max(1, Math.floor((used.used_at + ACCESS_TTL - t) / 1000)) } : unknown;
  }
  // Someone has a copy: the device is signed out.
  await env.DB.prepare("DELETE FROM oauth_tokens WHERE family = ?").bind(used.family).run();
  return unknown;
}

/**
 * POST /oauth/revoke (RFC 7009): signs out the device the token belongs to
 * (its family). Other devices stay connected; the connection goes with the last
 * one. Disconnect under Security removes the whole connection.
 */
export async function revokeToken(client: OAuthClient, token: string) {
  if (!token) return;
  const row = await env.DB.prepare(
    `SELECT t.key_id, t.family FROM oauth_tokens t JOIN api_keys k ON k.id = t.key_id
     WHERE t.id = ? AND k.client_id = ? AND k.user_id IS NOT NULL`,
  )
    .bind(await sha256(token), client.id)
    .first<{ key_id: string; family: string }>();
  if (!row) return;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_tokens WHERE family = ?").bind(row.family),
    env.DB.prepare(
      `DELETE FROM api_keys WHERE id = ?1 AND NOT EXISTS (
         SELECT 1 FROM oauth_tokens WHERE key_id = ?1 AND kind = 'refresh' AND used_at IS NULL AND expires_at > ?2)`,
    ).bind(row.key_id, now()),
  ]);
}

/**
 * Cron, hourly: expired codes and tokens, connections with no refresh token
 * left (every device signed out or gone quiet for 60 days), and registered apps
 * that never connected or have been disconnected for a long time. An app that
 * was disconnected keeps its registration, so it can sign in again with it.
 */
export async function purgeExpiredOAuth() {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").bind(t),
    // Used refresh tokens are kept a week, to recognise a copy coming back.
    env.DB.prepare("DELETE FROM oauth_tokens WHERE expires_at < ? OR used_at < ?").bind(t, t - USED_REFRESH_TTL),
    // A refresh's answer is only for a retry, within REUSE_GRACE.
    env.DB.prepare("UPDATE oauth_tokens SET answer = NULL WHERE answer IS NOT NULL AND used_at < ?").bind(t - REUSE_GRACE),
    // Not one being created right now (exchangeCode adds its tokens just after).
    env.DB.prepare(
      `DELETE FROM api_keys WHERE user_id IS NOT NULL AND created_at < ?1 AND (last_used_at IS NULL OR last_used_at < ?1)
       AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.key_id = api_keys.id AND t.kind = 'refresh' AND t.used_at IS NULL)`,
    ).bind(t - CODE_TTL),
    env.DB.prepare(
      `DELETE FROM oauth_clients WHERE (used_at IS NULL AND created_at < ?1 OR used_at < ?2)
       AND NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.client_id = oauth_clients.id)
       AND NOT EXISTS (SELECT 1 FROM oauth_codes c WHERE c.client_id = oauth_clients.id)`,
    ).bind(t - UNUSED_CLIENT_TTL, t - IDLE_CLIENT_TTL),
    // Past the cap, the oldest that never signed in make room.
    env.DB.prepare(
      `DELETE FROM oauth_clients WHERE used_at IS NULL AND created_at < ?1
       AND id NOT IN (SELECT id FROM oauth_clients WHERE used_at IS NULL ORDER BY created_at DESC LIMIT ?2)
       AND NOT EXISTS (SELECT 1 FROM oauth_codes c WHERE c.client_id = oauth_clients.id)`,
    ).bind(t - PENDING_CLIENT_KEEP, MAX_PENDING_CLIENTS),
  ]);
}
