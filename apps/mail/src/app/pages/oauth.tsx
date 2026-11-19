import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { appName } from "@/app/components/brand";
import { AccessEditor, type AccessTargets } from "@/app/components/key-dialog";
import { Button } from "@/app/components/ui/button";
import { json, redirect, requireUser, withFlash } from "@/app/http";
import { AuthCard } from "@/app/pages/auth";
import { grantsFromForm } from "@/lib/apikeys";
import type { User } from "@/lib/auth";
import { listMailboxAddressesForUser } from "@/lib/db";
import {
  AUTH_METHODS,
  type OAuthClient,
  type OAuthError,
  SCOPE,
  authenticateClient,
  clientRedirectUris,
  createCode,
  exchangeCode,
  getClient,
  isLoopback,
  redirectMatches,
  refreshTokens,
  registerClient,
  revokeToken,
} from "@/lib/oauth";

/*
 * OAuth for the MCP endpoint: discovery documents, client registration, the
 * consent screen and the token endpoints. The logic is in src/lib/oauth.ts.
 *
 * The consent screen posts a plain form (not a server function) because its
 * answer is a redirect to the app, as the sign-in forms end in a redirect.
 */

const DOCS = "https://gentlemail.dev/docs/mcp/";
const originOf = (request: Request) => new URL(request.url).origin;

/** Discovery documents can be read from any site; they hold nothing private. */
const discovery = (body: unknown) => json(body, 200, { "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=3600" });
const oauthJson = ({ status = 400, ...err }: OAuthError) =>
  json(err, status, { "Cache-Control": "no-store", ...(status === 401 ? { "WWW-Authenticate": 'Basic realm="oauth"' } : {}) });

/* ---------- Discovery ---------- */

/** RFC 9728: which server issues tokens for /mcp. Also served under /mcp, where clients look first. */
export const protectedResourceMetadata = ({ request }: RequestInfo) => {
  const origin = originOf(request);
  return discovery({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: appName(),
    resource_documentation: DOCS,
  });
};

/** RFC 8414. */
export const authorizationServerMetadata = ({ request }: RequestInfo) => {
  const origin = originOf(request);
  return discovery({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
    service_documentation: DOCS,
  });
};

/* ---------- Registration, tokens, revocation ---------- */

async function readForm(request: Request): Promise<FormData> {
  try {
    if ((request.headers.get("Content-Type") ?? "").includes("application/json")) {
      const form = new FormData();
      for (const [k, v] of Object.entries((await request.json()) as Record<string, unknown>)) if (v != null) form.set(k, String(v));
      return form;
    }
    return await request.formData();
  } catch {
    return new FormData();
  }
}

let warnedNoLimit = false;

export async function registerHandler({ request }: RequestInfo) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {}
  if (!body || typeof body !== "object" || Array.isArray(body))
    return oauthJson({ error: "invalid_client_metadata", error_description: "Send the client metadata as a JSON object." });
  // Registering needs no sign-in: a few per minute from one address is plenty for any assistant.
  const limiter = env.REGISTER_LIMIT as RateLimit | undefined; // absent in copies of wrangler.jsonc made before 0.6
  if (!limiter && !warnedNoLimit) {
    warnedNoLimit = true;
    console.warn("REGISTER_LIMIT is missing from wrangler.jsonc: app registrations are not rate limited. See https://gentlemail.dev/docs/updating/");
  }
  if (limiter && !(await limiter.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" })).success)
    return oauthJson({ error: "slow_down", error_description: "Too many registrations from this address. Try again in a minute.", status: 429 });
  const out = await registerClient(body as Record<string, unknown>);
  return "error" in out ? oauthJson(out) : json(out, 201, { "Cache-Control": "no-store" });
}

export async function tokenHandler({ request }: RequestInfo) {
  const form = await readForm(request);
  const client = await authenticateClient(request, form);
  if ("error" in client) return oauthJson(client);
  const grant = form.get("grant_type");
  const out =
    grant === "authorization_code"
      ? await exchangeCode(client, form)
      : grant === "refresh_token"
        ? await refreshTokens(client, form)
        : { error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token." };
  return "error" in out ? oauthJson(out) : json(out, 200, { "Cache-Control": "no-store", Pragma: "no-cache" });
}

/** RFC 7009: always 200, whether or not the token was known. */
export async function revokeHandler({ request }: RequestInfo) {
  const form = await readForm(request);
  const client = await authenticateClient(request, form);
  if ("error" in client) return oauthJson(client);
  await revokeToken(client, String(form.get("token") ?? ""));
  return new Response(null, { status: 200 });
}

/* ---------- The consent screen: /oauth/authorize ---------- */

const PARAMS = ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"];

/** `redirectUri`: where the answer goes; `requested`: the redirect_uri the app sent, if any, which its token request must repeat. */
type Authorization = {
  client: OAuthClient;
  redirectUri: string;
  requested: string | null;
  state: string | null;
  challenge: string;
  params: URLSearchParams;
};

/**
 * Checks an authorization request. A problem is shown here, not sent back to
 * the app: anyone can register any redirect URI, so an automatic redirect would
 * let a link on this site bounce people to it (RFC 9700 §4.11). Only the
 * person's own Allow or Cancel goes back to the app. The exception is an app on
 * this computer (http on localhost), which can't be an open redirect: it is sent
 * the error, so a command-line app waiting on its port hears of it at once.
 */
async function readAuthorization(p: URLSearchParams, origin: string): Promise<Authorization | { fatal: string } | { redirect: string }> {
  const client = await getClient(p.get("client_id") ?? "");
  if (!client)
    return { fatal: "This app isn't registered on this server, or its registration expired. Remove the server in the app and add it again." };
  const uris = clientRedirectUris(client);
  const redirectUri = p.get("redirect_uri") ?? (uris.length === 1 ? uris[0] : "");
  if (!redirectUri || !redirectMatches(uris, redirectUri))
    return { fatal: "The app asked to send you back to an address it didn't register. Nothing was shared." };

  const state = p.get("state");
  const local = isLoopback(new URL(redirectUri));
  const broken = (error: string, detail: string) =>
    local
      ? { redirect: redirectWith(redirectUri, origin, state, { error, error_description: `${detail[0].toUpperCase()}${detail.slice(1)}.` }) }
      : { fatal: `The app's sign-in request is broken (${detail}). Nothing was shared. Tell the app's makers, or try another app.` };
  if (p.get("response_type") !== "code") return broken("unsupported_response_type", "only response_type=code is supported");
  const challenge = p.get("code_challenge") ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || p.get("code_challenge_method") !== "S256")
    return broken("invalid_request", "PKCE is required, with code_challenge_method=S256");
  const resource = p.get("resource")?.replace(/\/$/, "");
  if (resource && resource !== origin && resource !== `${origin}/mcp`) return broken("invalid_target", `resource must be ${origin}/mcp`);

  const params = new URLSearchParams();
  for (const k of PARAMS) if (p.get(k) != null) params.set(k, p.get(k)!);
  return { client, redirectUri, requested: p.get("redirect_uri"), state, challenge, params };
}

function redirectWith(uri: string, origin: string, state: string | null, values: Record<string, string>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(values)) u.searchParams.set(k, v);
  if (state != null) u.searchParams.set("state", state);
  u.searchParams.set("iss", origin);
  return u.toString();
}

/** What this person may give an assistant: an admin anything, anyone else the mailboxes they can open. */
async function targetsFor(user: User) {
  const admin = user.role === "admin";
  const [mailboxes, { results: domains }] = await Promise.all([
    listMailboxAddressesForUser(user),
    admin ? env.DB.prepare("SELECT id, name FROM domains ORDER BY name").all<{ id: string; name: string }>() : { results: [] },
  ]);
  const targets: AccessTargets = { domains, mailboxes };
  const allowed = new Set([
    ...(user.role === "admin" ? ["all"] : []),
    ...domains.map((d) => `domain:${d.id}`),
    ...mailboxes.map((m) => `mailbox:${m.id}`),
  ]);
  return { targets, allowed, allowAll: user.role === "admin" };
}

/**
 * Where the answer goes: the site, or which kind of app. An app's own scheme
 * is shown whole, as it was registered (without its query), never shaped like a
 * site's address: "claude.ai:cb" must not read as claude.ai.
 */
function destination(uri: string): { where: string; note: string; site: boolean } {
  const u = new URL(uri);
  if (u.protocol === "http:") return { where: u.host, note: "An app on this computer, not a website.", site: false };
  if (u.protocol === "https:") return { where: u.hostname, note: "A website.", site: true };
  const where = uri.split(/[?#]/)[0];
  return { where, note: `Not a website: an app installed on this device, which opens links starting with ${u.protocol}`, site: false };
}

/** The consent screen's errors, by code: its ?err= is never shown as written, so a link can't put words on it. */
const CONSENT_ERRORS: Record<string, string> = {
  nothing_ticked: "Tick Read, Organize or Send on at least one line, or choose Cancel.",
};

export async function AuthorizePage(ri: RequestInfo) {
  const denied = requireUser(ri);
  if (denied) return denied;
  const url = new URL(ri.request.url);
  const req = await readAuthorization(url.searchParams, url.origin);
  if ("redirect" in req) return redirect(req.redirect);
  if ("fatal" in req)
    return (
      <AuthCard title="Can't connect this app" err={req.fatal}>
        <a href="/" className="text-sm font-medium underline-offset-4 hover:underline">
          Back to your mail
        </a>
      </AuthCard>
    );

  // A form's redirect must be allowed by form-action too: let the answer go back to the app.
  const target = new URL(req.redirectUri);
  const source = target.protocol === "http:" || target.protocol === "https:" ? target.origin : target.protocol;
  const csp = ri.response.headers.get("Content-Security-Policy");
  if (csp) ri.response.headers.set("Content-Security-Policy", csp.replace("form-action 'self'", `form-action 'self' ${source}`));

  const user = ri.ctx.user!;
  const { targets, allowAll } = await targetsFor(user);
  // An admin may give all mailboxes or a domain even before any mailbox exists.
  const shareable = allowAll || targets.domains.length > 0 || targets.mailboxes.length > 0;
  const err = CONSENT_ERRORS[url.searchParams.get("err") ?? ""] ?? null;
  const strong = "font-medium text-foreground";

  const dest = destination(req.redirectUri);

  return (
    <AuthCard title="Connect an assistant" err={err}>
      <p className="text-sm leading-relaxed text-muted-foreground">
        An app that calls itself <span className={strong}>“{req.client.name}”</span> wants to use mail as{" "}
        <span className={strong}>{user.email}</span>. Choose what it may read, organize and send. You can disconnect it at any time under
        Security.
      </p>
      {/* Anyone can register an app under any name, so the address is what to check. */}
      <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm">
        <div className="text-xs text-muted-foreground">If you allow it, access is given to</div>
        <div className="mt-1 break-all font-mono text-base font-semibold text-foreground">{dest.where}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {dest.note} The app picks its own name, so check this address instead{dest.site ? ": for Claude it is the website claude.ai" : ""}. If
          you didn't just start connecting an assistant yourself, choose Cancel.
        </div>
      </div>
      <form method="post" className="mt-4 grid gap-4">
        {[...req.params].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {shareable ? (
          <AccessEditor targets={targets} initial={{}} allowAll={allowAll} />
        ) : (
          <p className="text-sm text-muted-foreground">You can't open any mailbox yet, so there is nothing to share. Ask an admin.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button type="submit" name="decision" value="allow" size="lg" disabled={!shareable}>
            Allow
          </Button>
          <Button type="submit" name="decision" value="deny" size="lg" variant="outline">
            Cancel
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}

export async function authorizeAction(ri: RequestInfo) {
  const denied = requireUser(ri);
  if (denied) return denied;
  const form = await ri.request.formData();
  const p = new URLSearchParams();
  for (const k of PARAMS) if (form.get(k) != null) p.set(k, String(form.get(k)));
  const origin = originOf(ri.request);
  const req = await readAuthorization(p, origin);
  if ("redirect" in req) return redirect(req.redirect);
  if ("fatal" in req) return redirect(`/oauth/authorize?${p}`);

  if (form.get("decision") !== "allow")
    return redirect(redirectWith(req.redirectUri, origin, req.state, { error: "access_denied", error_description: "The request was declined." }));

  const user = ri.ctx.user!;
  const grants = await grantsFromForm(form, (await targetsFor(user)).allowed);
  if (!grants.some((g) => g.can_read || g.can_organize || g.can_send))
    return redirect(withFlash(`/oauth/authorize?${req.params}`, "err", "nothing_ticked"));

  const code = await createCode({ clientId: req.client.id, userId: user.id, redirectUri: req.requested, challenge: req.challenge, grants });
  return redirect(redirectWith(req.redirectUri, origin, req.state, { code }));
}
