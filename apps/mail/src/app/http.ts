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

/** Reject cross-site form posts (CSRF). */
export function checkOrigin({ request }: RequestInfo) {
  if (request.method === "GET" || request.method === "HEAD") return;
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

/** Signed in, two-step set up if an admin requires it (otherwise sent to set it up). */
export function requireUser(ri: RequestInfo) {
  const denied = requireSignedIn(ri);
  if (denied) return denied;
  if (ri.ctx.user!.mustSetUpMfa) return redirect("/account/security");
}

/** Signed in, nothing more: for the Security page, where required two-step is set up. */
export function requireSignedIn({ ctx, request }: RequestInfo) {
  if (!ctx.user) {
    const url = new URL(request.url);
    return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
}

export const notFound = () => new Response("Not found", { status: 404 });
