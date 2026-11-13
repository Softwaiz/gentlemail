import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import { createSession, createUser, destroySession, verifyPassword } from "@/lib/auth";
import { field, redirect, withFlash } from "@/app/http";
import { LogoMark, appName } from "@/app/components/brand";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

/**
 * Full-bleed ink screen in the Softwaiz manner: grid texture, oversized
 * display wordmark, and a paper card holding the form.
 */
export function AuthCard({ title, children, err }: { title: string; children: React.ReactNode; err?: string | null }) {
  return (
    <div className="bg-grid relative min-h-screen overflow-hidden bg-sidebar text-sidebar-foreground">
      <div className="mx-auto grid min-h-screen max-w-[1180px] items-center gap-10 px-5 py-10 md:grid-cols-[minmax(0,1fr)_400px] md:px-10">
        <div className="min-w-0">
          <div className="mb-8 flex items-center gap-3 text-[15px]">
            <LogoMark className="size-9 ring-1 ring-sidebar-border rounded-[10px]" />
            <span className="text-sidebar-muted">Mail for every domain you run</span>
          </div>
          <div aria-hidden="true" className="font-display text-[clamp(64px,11vw,148px)] leading-[0.92] tracking-[-0.02em] break-words">
            {appName()}
            <span className="text-lime">.</span>
          </div>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-sidebar-muted">
            Receive, read and answer mail for all your domains in one place. Your messages stay on your own Cloudflare
            account.
          </p>
        </div>

        <div className="rounded-lg border border-sidebar-border bg-background p-7 text-foreground shadow-[0_30px_80px_-20px_rgb(0_0_0/60%)]">
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
          {err && (
            <div role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {err}
            </div>
          )}
          <div className="mt-5">{children}</div>
        </div>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -bottom-40 size-[420px] rounded-full bg-lime/10 blur-3xl" />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
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
      <form method="post" className="grid gap-4">
        <input type="hidden" name="next" value={u.searchParams.get("next") ?? "/"} />
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="username" autoFocus className="h-10" />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" required autoComplete="current-password" className="h-10" />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full">
          Sign in
        </Button>
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
        <p className="text-sm leading-relaxed text-muted-foreground">
          Set a one-time setup token first, then reload this page:
        </p>
        <pre className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs">npx wrangler secret put SETUP_TOKEN</pre>
        <p className="mt-3 text-xs text-muted-foreground">
          Locally, put <code className="font-mono">SETUP_TOKEN=…</code> in <code className="font-mono">.dev.vars</code>.
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Create the admin account" err={err}>
      <form method="post" className="grid gap-4">
        <Field label="Setup token">
          <Input name="token" type="password" required className="h-10" />
        </Field>
        <Field label="Your name">
          <Input name="name" required className="h-10" />
        </Field>
        <Field label="Login email">
          <Input name="email" type="email" required className="h-10" />
        </Field>
        <Field label="Password (10 characters or more)">
          <Input name="password" type="password" minLength={10} required autoComplete="new-password" className="h-10" />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full">
          Create admin account
        </Button>
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
