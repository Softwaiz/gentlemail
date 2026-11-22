import { env } from "cloudflare:workers";
import type { RequestInfo } from "rwsdk/worker";
import {
  CHALLENGE_MAX_ATTEMPTS,
  createLoginChallenge,
  createSession,
  createUser,
  destroySession,
  endLoginChallenge,
  getLoginChallenge,
  verifyPassword,
} from "@/lib/auth";
import { recoveryCodesLeft, verifySecondFactor } from "@/lib/mfa";
import { field, flashText, redirect, safeNext, withFlash } from "@/app/http";
import { ShakeCard } from "@/app/components/auth-motion";
import { LogoMark, Wordmark, appName, hasLogo } from "@/app/components/brand";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { PasswordInput } from "@/app/components/password-input";


/**
 * Full-bleed ink screen in the Softwaiz manner: grid texture, oversized
 * display wordmark, and a paper card holding the form.
 */
/** The id of the card's error, for the fields it is about (aria-describedby). */
const AUTH_ERROR = "auth-error";

export function AuthCard({ title, children, err }: { title: string; children: React.ReactNode; err?: string | null }) {
  return (
    <div className="bg-grid relative min-h-screen overflow-hidden bg-sidebar text-sidebar-foreground">
      <div className="mx-auto grid min-h-screen max-w-[1180px] items-center gap-10 px-5 py-10 md:grid-cols-[minmax(0,1fr)_400px] md:px-10">
        <div className="min-w-0">
          <div className="mb-8 flex items-center gap-3 text-[15px]">
            <LogoMark className="size-9 ring-1 ring-sidebar-border rounded-[10px]" />
            <span className="text-sidebar-muted">Mail for every domain you run</span>
          </div>
          {hasLogo() ? (
            <Wordmark className="h-[clamp(44px,7vw,92px)] max-w-full" />
          ) : (
            <div aria-hidden="true" className="text-[clamp(48px,8vw,104px)] leading-[0.95] font-bold tracking-[-0.045em] break-words">
              {appName()}
              <span className="text-lime">.</span>
            </div>
          )}
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-sidebar-muted">
            Receive, read and answer mail for all your domains in one place. Your messages stay on your own Cloudflare
            account.
          </p>
        </div>

        <ShakeCard
          error={err}
          className="rounded-lg border border-sidebar-border bg-background p-7 text-foreground shadow-[0_30px_80px_-20px_rgb(0_0_0/60%)]"
        >
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
          {err && (
            <div
              id={AUTH_ERROR}
              role="alert"
              className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
            >
              {err}
            </div>
          )}
          <div className="mt-5">{children}</div>
        </ShakeCard>
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
  return <LoginForm next={u.searchParams.get("next") ?? "/"} err={flashText(u.searchParams.get("err"))} />;
}

/**
 * The sign-in form. After a wrong password it is sent back in answer to the POST (not by a
 * redirect), so the email stays filled in without going into the URL, and the cursor waits
 * in the emptied password field.
 */
function LoginForm({ next, email, err, wrong }: { next: string; email?: string; err?: string | null; wrong?: boolean }) {
  return (
    <AuthCard title="Sign in" err={err}>
      <form method="post" className="grid gap-4">
        <input type="hidden" name="next" value={next} />
        <Field label="Email">
          <Input
            name="email"
            type="email"
            required
            autoComplete="username"
            defaultValue={email}
            autoFocus={!email}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? AUTH_ERROR : undefined}
            className="h-10"
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            name="password"
            required
            autoComplete="current-password"
            autoFocus={!!email}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? AUTH_ERROR : undefined}
            className="h-10"
          />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}

export async function loginAction({ request, response }: RequestInfo) {
  const form = await request.formData();
  const email = field(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(field(form, "next"));
  const row = await env.DB.prepare("SELECT id, password_hash, mfa_enabled_at FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; password_hash: string; mfa_enabled_at: number | null }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    response.status = 401;
    return <LoginForm next={next} email={email} err="Wrong email or password." wrong />;
  }
  if (row.mfa_enabled_at) {
    // Second step: no session until the code is right.
    return redirect("/login/verify", { "Set-Cookie": await createLoginChallenge(row.id, next, request) });
  }
  const cookie = await createSession(row.id, request);
  return redirect(next, { "Set-Cookie": cookie });
}

/* ---------- Second step: code from the authenticator app, or a recovery code ---------- */

export async function LoginVerifyPage({ request, ctx }: RequestInfo) {
  if (ctx.user) return redirect("/");
  const challenge = await getLoginChallenge(request);
  if (!challenge) return redirect(withFlash("/login", "err", "signin_timeout"));
  return <VerifyForm email={challenge.email} />;
}

function VerifyForm({ email, err }: { email: string; err?: string }) {
  return (
    <AuthCard title="Two-step verification" err={err}>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        Enter the 6-digit code from your authenticator app for <span className="font-medium text-foreground">{email}</span>.
      </p>
      <form method="post" className="grid gap-4">
        <Field label="Code">
          <Input
            name="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={20}
            placeholder="123456"
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? AUTH_ERROR : undefined}
            className="h-11 font-mono text-lg tracking-[0.3em]"
          />
        </Field>
        <Button type="submit" size="lg" className="w-full">
          Verify
        </Button>
      </form>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        No access to your app? Type one of your recovery codes (like <span className="font-mono">abcde-23456</span>) in the same box. Each one works once.
      </p>
      <a href="/login" className="mt-3 inline-block text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
        Use another account
      </a>
    </AuthCard>
  );
}

export async function loginVerifyAction({ request, response }: RequestInfo) {
  const challenge = await getLoginChallenge(request);
  if (!challenge) return redirect(withFlash("/login", "err", "signin_timeout"));
  const code = String((await request.formData()).get("code") ?? "");
  const result = await verifySecondFactor(challenge.user_id, code, { allowRecovery: true });

  if (!result.ok) {
    const attempts = challenge.attempts + 1;
    if (attempts >= CHALLENGE_MAX_ATTEMPTS) {
      const cookie = await endLoginChallenge(challenge.id, request);
      return redirect(withFlash("/login", "err", "too_many_codes"), { "Set-Cookie": cookie });
    }
    await env.DB.prepare("UPDATE login_challenges SET attempts = ? WHERE id = ?").bind(attempts, challenge.id).run();
    const left = CHALLENGE_MAX_ATTEMPTS - attempts;
    response.status = 401;
    return <VerifyForm email={challenge.email} err={`That code didn't work. ${left} ${left === 1 ? "try" : "tries"} left.`} />;
  }

  const headers = new Headers();
  headers.append("Set-Cookie", await endLoginChallenge(challenge.id, request));
  headers.append("Set-Cookie", await createSession(challenge.user_id, request));
  let next = safeNext(challenge.next);
  if (result.usedRecovery) {
    const left = await recoveryCodesLeft(challenge.user_id);
    // Security says how many codes are left, then offers to continue to `next` (an assistant's sign-in, say).
    const security = next === "/" ? "/account/security" : `/account/security?next=${encodeURIComponent(next)}`;
    // The security page shows how many codes are left.
    next = left ? withFlash(security, "msg", "recovery_used") : withFlash(security, "err", "recovery_last");
  }
  return redirect(next, headers);
}

export async function logoutAction({ request }: RequestInfo) {
  const cookie = await destroySession(request);
  return redirect("/login", { "Set-Cookie": cookie });
}

/* ---------- First-run setup ---------- */

export async function SetupPage() {
  if ((await userCount()) > 0) return redirect("/login");
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
  return <SetupForm />;
}

function SetupForm({ err, bad, name, email }: { err?: string; bad?: "token" | "password"; name?: string; email?: string }) {
  const invalid = (f: "token" | "password") => (bad === f ? { "aria-invalid": true, "aria-describedby": AUTH_ERROR, autoFocus: true } : {});
  return (
    <AuthCard title="Create the admin account" err={err}>
      <form method="post" className="grid gap-4">
        <Field label="Setup token">
          <PasswordInput name="token" what="setup token" required className="h-10" {...invalid("token")} />
        </Field>
        <Field label="Your name">
          <Input name="name" required defaultValue={name} className="h-10" />
        </Field>
        <Field label="Login email">
          <Input name="email" type="email" required defaultValue={email} className="h-10" />
        </Field>
        <Field label="Password (10 characters or more)">
          <PasswordInput name="password" minLength={10} required autoComplete="new-password" className="h-10" {...invalid("password")} />
        </Field>
        <Button type="submit" size="lg" className="mt-1 w-full">
          Create admin account
        </Button>
      </form>
    </AuthCard>
  );
}

export async function setupAction({ request, response }: RequestInfo) {
  if ((await userCount()) > 0) return redirect("/login");
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const kept = { name: field(form, "name"), email: field(form, "email") };
  if (!env.SETUP_TOKEN || token !== env.SETUP_TOKEN) {
    response.status = 403;
    return <SetupForm {...kept} err="Invalid setup token." bad="token" />;
  }
  const password = String(form.get("password") ?? "");
  if (password.length < 10) {
    response.status = 400;
    return <SetupForm {...kept} err="Password too short: use 10 characters or more." bad="password" />;
  }
  const id = await createUser({
    email: field(form, "email"),
    name: field(form, "name") || "Admin",
    password,
    role: "admin",
  });
  const cookie = await createSession(id, request);
  return redirect("/admin", { "Set-Cookie": cookie });
}
