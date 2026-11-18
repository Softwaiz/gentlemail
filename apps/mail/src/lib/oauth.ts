import { env } from "cloudflare:workers";
import { sha256 } from "./auth";
import type { Grant } from "./apikeys";
import { newId, now } from "./util";

/*
 * The OAuth 2.1 authorization server behind /mcp, kept in D1.
 *
 * An assistant registers itself (Dynamic Client Registration), sends the person
 * to /oauth/authorize, where they sign in and choose what it may read and send,
 * then trades the code for tokens (PKCE, S256 only). What it gets is a
 * connection: an api_keys row with user_id set, so the same grants and checks
 * as API keys apply, limited to what that person can open (see authenticate()).
 *
 * Access tokens last an hour; refresh tokens 60 days, and each use replaces
 * the refresh token. Only SHA-256 hashes of codes, tokens and client secrets
 * are stored.
 */

export const ACCESS_PREFIX = "gma_";
const REFRESH_PREFIX = "gmr_";
const CODE_PREFIX = "gmc_";
export const ACCESS_TTL = 60 * 60 * 1000;
export const REFRESH_TTL = 60 * 24 * 60 * 60 * 1000;
const CODE_TTL = 5 * 60 * 1000;
/** Registered apps that never connected are removed after a day. */
const UNUSED_CLIENT_TTL = 24 * 60 * 60 * 1000;
export const SCOPE = "mail";

export type OAuthClient = { id: string; name: string; redirect_uris: string; secret_hash: string | null; created_at: number };
export type TokenSet = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };
/** An OAuth error, as the token and registration endpoints return it (RFC 6749 §5.2). */
export type OAuthError = { error: string; error_description: string; status?: number };

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = (prefix: string) => prefix + b64url(crypto.getRandomValues(new Uint8Array(32)));
const oauthError = (error: string, error_description: string, status = 400): OAuthError => ({ error, error_description, status });

/* ---------- Redirect URIs ---------- */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLoopback = (u: URL) => u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
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

const AUTH_METHODS = new Set(["none", "client_secret_post", "client_secret_basic"]);

/** POST /oauth/register (RFC 7591). Open to anyone: it only lets an app ask; the person decides. */
export async function registerClient(body: Record<string, unknown>) {
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string" && u.length <= 2000))
    return oauthError("invalid_redirect_uri", "Send redirect_uris: one to ten URLs.");
  for (const u of uris as string[]) {
    const problem = redirectUriProblem(u);
    if (problem) return oauthError("invalid_redirect_uri", problem);
  }
  const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
  if (!AUTH_METHODS.has(method)) return oauthError("invalid_client_metadata", "token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.");
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ["authorization_code", "refresh_token"];
  if (!grantTypes.includes("authorization_code")) return oauthError("invalid_client_metadata", "grant_types must include authorization_code.");

  const name = (typeof body.client_name === "string" ? body.client_name : "").replace(/\s+/g, " ").trim().slice(0, 80) || "An unnamed app";
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
export async function createCode(input: { clientId: string; userId: string; redirectUri: string; challenge: string; grants: Grant[] }) {
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

async function issueTokens(keyId: string): Promise<TokenSet> {
  const access = randomToken(ACCESS_PREFIX);
  const refresh = randomToken(REFRESH_PREFIX);
  const t = now();
  const insert = "INSERT INTO oauth_tokens (id, key_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)";
  await env.DB.batch([
    env.DB.prepare(insert).bind(await sha256(access), keyId, "access", t + ACCESS_TTL, t),
    env.DB.prepare(insert).bind(await sha256(refresh), keyId, "refresh", t + REFRESH_TTL, t),
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: SCOPE };
}

/** grant_type=authorization_code: checks the code, PKCE and redirect URI, then connects the app. */
export async function exchangeCode(client: OAuthClient, form: FormData): Promise<TokenSet | OAuthError> {
  const code = String(form.get("code") ?? "");
  const verifier = String(form.get("code_verifier") ?? "");
  if (!code || !verifier) return oauthError("invalid_request", "Send code and code_verifier.");
  // Deleted as it is read, so a code works once even if two requests race.
  const row = await env.DB.prepare("DELETE FROM oauth_codes WHERE id = ? RETURNING *")
    .bind(await sha256(code))
    .first<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string; grants: string; expires_at: number }>();
  if (!row || row.expires_at < now() || row.client_id !== client.id) return oauthError("invalid_grant", "This code is unknown, used or expired. Sign in again.");
  const redirectUri = form.get("redirect_uri");
  if (redirectUri != null && String(redirectUri) !== row.redirect_uri) return oauthError("invalid_grant", "redirect_uri doesn't match the one used to sign in.");
  if ((await s256(verifier)) !== row.code_challenge) return oauthError("invalid_grant", "code_verifier doesn't match the code_challenge.");

  const grants: Grant[] = JSON.parse(row.grants);
  // Signing in again from the same app updates its connection instead of adding another.
  const existing = await env.DB.prepare("SELECT id FROM api_keys WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL")
    .bind(row.user_id, client.id)
    .first<{ id: string }>();
  const keyId = existing?.id ?? newId();
  const grantRows = grants.map((g) =>
    env.DB.prepare("INSERT INTO api_key_grants (key_id, target_type, target_id, can_read, can_send) VALUES (?, ?, ?, ?, ?)").bind(
      keyId,
      g.target_type,
      g.target_id,
      g.can_read,
      g.can_send,
    ),
  );
  await env.DB.batch([
    existing
      ? env.DB.prepare("DELETE FROM oauth_tokens WHERE key_id = ?").bind(keyId)
      : env.DB.prepare(
          `INSERT INTO api_keys (id, name, prefix, key_hash, mailbox_id, scopes, created_by, created_at, user_id, client_id)
           VALUES (?, ?, 'oauth', ?, NULL, '', ?, ?, ?, ?)`,
        ).bind(keyId, client.name, `oauth:${keyId}`, row.user_id, now(), row.user_id, client.id),
    env.DB.prepare("DELETE FROM api_key_grants WHERE key_id = ?").bind(keyId),
    ...grantRows,
  ]);
  return issueTokens(keyId);
}

/** grant_type=refresh_token: a new pair; the refresh token used is gone. */
export async function refreshTokens(client: OAuthClient, form: FormData): Promise<TokenSet | OAuthError> {
  const token = String(form.get("refresh_token") ?? "");
  if (!token.startsWith(REFRESH_PREFIX)) return oauthError("invalid_grant", "Unknown refresh token.");
  const row = await env.DB.prepare(
    `DELETE FROM oauth_tokens WHERE id = ? AND kind = 'refresh'
     AND key_id IN (SELECT id FROM api_keys WHERE client_id = ? AND revoked_at IS NULL) RETURNING key_id, expires_at`,
  )
    .bind(await sha256(token), client.id)
    .first<{ key_id: string; expires_at: number }>();
  if (!row || row.expires_at < now()) return oauthError("invalid_grant", "This refresh token is unknown, used or expired. Sign in again.");
  return issueTokens(row.key_id);
}

/** POST /oauth/revoke (RFC 7009): any of a connection's tokens ends the whole connection. */
export async function revokeToken(client: OAuthClient, token: string) {
  if (!token) return;
  await env.DB.prepare(
    `DELETE FROM api_keys WHERE client_id = ? AND user_id IS NOT NULL
     AND id IN (SELECT key_id FROM oauth_tokens WHERE id = ?)`,
  )
    .bind(client.id, await sha256(token))
    .run();
}

/** Cron, hourly: expired codes and tokens, and registered apps that never connected. */
export async function purgeExpiredOAuth() {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM oauth_tokens WHERE expires_at < ?").bind(t),
    env.DB.prepare(
      `DELETE FROM oauth_clients WHERE created_at < ?
       AND NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.client_id = oauth_clients.id)
       AND NOT EXISTS (SELECT 1 FROM oauth_codes c WHERE c.client_id = oauth_clients.id)`,
    ).bind(t - UNUSED_CLIENT_TTL),
  ]);
}
