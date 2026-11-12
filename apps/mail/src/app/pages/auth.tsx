import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { createSession, createUser, destroySession, verifyPassword } from "@/lib/auth";
import { field, redirect, withFlash } from "@/app/http";
import { appName } from "@/app/components/shell";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

function AuthCard({ title, children, err }: { title: string; children: React.ReactNode; err?: string | null }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand center">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <span>{appName()}</span>
        </div>
        <h1>{title}</h1>
        {err && <div className="flash err">{err}</div>}
        {children}
      </div>
    </div>
  );
}

const userCount = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n ?? 0;

/* ---------- Login ---------- */

export async function LoginPage({ request, ctx }: RequestInfo) {
  if (ctx.user) return redirect("/");
  if ((await userCount()) === 0) return redirect("/setup");
  const u = new URL(request.url);
  return (
    <AuthCard title="Sign in" err={u.searchParams.get("err")}>
      <form method="post" className="stack">
        <input type="hidden" name="next" value={u.searchParams.get("next") ?? "/"} />
        <label>
          Email
          <input name="email" type="email" required autoComplete="username" autoFocus />
        </label>
        <label>
          Password
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <button className="btn btn-primary" type="submit">
          Sign in
        </button>
      </form>
    </AuthCard>
  );
}

export async function loginAction({ request }: RequestInfo) {
  const form = await request.formData();
  const email = field(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(field(form, "next"));
  const row = await env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; password_hash: string }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return redirect(withFlash(`/login?next=${encodeURIComponent(next)}`, "err", "Wrong email or password."));
  }
  const cookie = await createSession(row.id, request);
  return redirect(next, { "Set-Cookie": cookie });
}

export async function logoutAction({ request }: RequestInfo) {
  const cookie = await destroySession(request);
  return redirect("/login", { "Set-Cookie": cookie });
}

/* ---------- First-run setup ---------- */

export async function SetupPage({ request }: RequestInfo) {
  if ((await userCount()) > 0) return redirect("/login");
  const err = new URL(request.url).searchParams.get("err");
  if (!env.SETUP_TOKEN) {
    return (
      <AuthCard title="Setup">
        <p>
          Set a one-time setup token first:
          <br />
          <code>wrangler secret put SETUP_TOKEN</code>
          <br />
          (or <code>SETUP_TOKEN=…</code> in <code>.dev.vars</code> locally), then reload.
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Create the admin account" err={err}>
      <form method="post" className="stack">
        <label>
          Setup token
          <input name="token" type="password" required />
        </label>
        <label>
          Your name
          <input name="name" required />
        </label>
        <label>
          Login email
          <input name="email" type="email" required />
        </label>
        <label>
          Password (min. 10 characters)
          <input name="password" type="password" minLength={10} required autoComplete="new-password" />
        </label>
        <button className="btn btn-primary" type="submit">
          Create admin
        </button>
      </form>
    </AuthCard>
  );
}

export async function setupAction({ request }: RequestInfo) {
  if ((await userCount()) > 0) return redirect("/login");
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  if (!env.SETUP_TOKEN || token !== env.SETUP_TOKEN) {
    return redirect(withFlash("/setup", "err", "Invalid setup token."));
  }
  const password = String(form.get("password") ?? "");
  if (password.length < 10) return redirect(withFlash("/setup", "err", "Password too short."));
  const id = await createUser({
    email: field(form, "email"),
    name: field(form, "name") || "Admin",
    password,
    role: "admin",
  });
  const cookie = await createSession(id, request);
  return redirect("/admin", { "Set-Cookie": cookie });
}
