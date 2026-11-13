import { env } from "cloudflare:workers";
import { sha256 } from "./auth";
import { newId, now } from "./util";

export type Scope = "send" | "read";
export const SCOPES: { id: Scope; label: string; hint: string }[] = [
  { id: "send", label: "Send", hint: "Send mail from the allowed mailboxes" },
  { id: "read", label: "Read", hint: "List and read messages and attachments, mark read, archive" },
];

export type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  mailbox_id: string | null;
  scopes: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
};

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Creates a key and returns the plain value. It is shown once and only its hash is stored. */
export async function createApiKey(input: { name: string; mailboxId: string | null; scopes: Scope[]; userId: string }) {
  const key = `gm_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const id = newId();
  await env.DB.prepare(
    `INSERT INTO api_keys (id, name, prefix, key_hash, mailbox_id, scopes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, input.name, key.slice(0, 10), await sha256(key), input.mailboxId, input.scopes.join(","), input.userId, now())
    .run();
  return { id, key };
}

export type ApiAuth = { key: ApiKeyRow; scopes: Set<Scope> };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export const apiError = (status: number, code: string, message: string) => json(status, { error: { code, message } });
export const apiJson = (body: unknown, status = 200) => json(status, body);

/** Checks the Bearer key and scope. Returns the key, or an error response. */
export async function authenticate(request: Request, scope: Scope): Promise<ApiAuth | Response> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return apiError(401, "unauthorized", "Send your API key as: Authorization: Bearer <key>");
  const key = await env.DB.prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL")
    .bind(await sha256(token))
    .first<ApiKeyRow>();
  if (!key) return apiError(401, "unauthorized", "Unknown or revoked API key.");
  const scopes = new Set(key.scopes.split(",").filter(Boolean) as Scope[]);
  if (!scopes.has(scope)) return apiError(403, "forbidden", `This key lacks the "${scope}" scope.`);
  // Cheap enough to do on every call; keeps "last used" honest in the admin UI.
  await env.DB.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now(), key.id).run();
  return { key, scopes };
}

/** True when the key may act on this mailbox. */
export const keyAllowsMailbox = (auth: ApiAuth, mailboxId: string) =>
  auth.key.mailbox_id === null || auth.key.mailbox_id === mailboxId;
