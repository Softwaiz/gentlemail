import type { RequestInfo } from "rwsdk/worker";

export const redirect = (location: string, headers?: HeadersInit) => {
  const h = new Headers(headers);
  h.set("Location", location);
  return new Response(null, { status: 303, headers: h });
};

/** Build a URL with ?msg= / ?err= flash parameters. */
export const withFlash = (path: string, kind: "msg" | "err", text: string) => {
  const u = new URL(path, "http://x");
  u.searchParams.set(kind, text);
  return u.pathname + u.search;
};

export const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export { json } from "@/lib/util";

/**
 * A path on this site to go back to after signing in; anything else becomes "/".
 * Browsers drop tabs and newlines from URLs and read a backslash as "/", so "/\t/evil.com"
 * would lead elsewhere: those are refused, and the result must stay on this origin.
 */
export function safeNext(n: string | null) {
  if (!n || !n.startsWith("/") || /[\s\\\x00-\x1f\x7f]/.test(n)) return "/";
  try {
    const u = new URL(n, "https://x.invalid");
    const path = u.pathname + u.search + u.hash;
    // Checked on the result, which "/.//evil.com" turns into "//evil.com".
    return u.origin === "https://x.invalid" && !/^\/[/\\]/.test(path) ? path : "/";
  } catch {
    return "/";
  }
}

/*
 * Endpoints for AI assistants, some of which run in a browser: they answer any
 * site (CORS) and skip checkOrigin. That's safe because they never read cookies,
 * only tokens and client credentials the caller sends.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};
const corsPaths = new Set<string>();
/** "/mcp/" and "/mcp" are the same route: compared without trailing slashes. */
const corsKey = (path: string) => path.replace(/\/+$/, "") || "/";

/** Wraps a token endpoint: answers the preflight, adds CORS headers, allows only `methods` (others get 405). */
export function cors(path: string, methods: string[], handler: (ri: RequestInfo) => Response | Promise<Response>) {
  corsPaths.add(corsKey(path));
  const allow = [...methods, "OPTIONS"].join(", ");
  return async (ri: RequestInfo) => {
    const headers = { ...CORS_HEADERS, "Access-Control-Allow-Methods": allow };
    if (ri.request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const res = methods.includes(ri.request.method) ? await handler(ri) : new Response(null, { status: 405, headers: { Allow: allow } });
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
    return out;
  };
}

/** Reject cross-site form posts (CSRF). */
export function checkOrigin({ request }: RequestInfo) {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (corsPaths.has(corsKey(new URL(request.url).pathname))) return;
  const blocked = () => new Response("Cross-origin request blocked", { status: 403 });
  // Modern browsers: trust Sec-Fetch-Site when present.
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin" || site === "none" ? undefined : blocked();
  // Fallback: compare Origin with our host ("null" or garbage → reject).
  const origin = request.headers.get("Origin");
  if (!origin) return;
  try {
    if (new URL(origin).host !== new URL(request.url).host) return blocked();
  } catch {
    return blocked();
  }
}

/** Signed in, two-step set up if an admin requires it (otherwise sent to set it up, then back to this page). */
export function requireUser(ri: RequestInfo) {
  const denied = requireSignedIn(ri);
  if (denied) return denied;
  if (ri.ctx.user!.mustSetUpMfa) {
    const url = new URL(ri.request.url);
    const back = ri.request.method === "GET" && url.pathname !== "/" ? `?next=${encodeURIComponent(url.pathname + url.search)}` : "";
    return redirect(`/account/security${back}`);
  }
}

/** Signed in, nothing more: for the Security page, where required two-step is set up. */
export function requireSignedIn({ ctx, request }: RequestInfo) {
  if (!ctx.user) {
    const url = new URL(request.url);
    return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
}

export const notFound = () => new Response("Not found", { status: 404 });
