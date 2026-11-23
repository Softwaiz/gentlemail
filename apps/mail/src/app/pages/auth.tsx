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
import { LoginView, SetupView, VerifyView } from "@/app/pages/auth-views";
import { plural, t } from "@lingui/core/macro";

export { AuthCard } from "@/app/pages/auth-views";

const userCount = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n ?? 0;

/* ---------- Login ---------- */

export async function LoginPage({ request, ctx }: RequestInfo) {
  if (ctx.user) return redirect("/");
  if ((await userCount()) === 0) return redirect("/setup");
  const u = new URL(request.url);
  return <LoginView next={u.searchParams.get("next") ?? "/"} err={flashText(u.searchParams.get("err"), ["signin_timeout", "too_many_codes"])} />;
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
    return <LoginView next={next} email={email} err={t({ id: "signin.wrong_credentials", message: "Wrong email or password." })} wrong />;
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
  return <VerifyView email={challenge.email} />;
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
    return <VerifyView email={challenge.email} err={t({ id: "verify.code_wrong", message: plural(left, { one: "That code didn't work. # try left.", other: "That code didn't work. # tries left." }) })} />;
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
  return <SetupView hasToken={!!env.SETUP_TOKEN} />;
}

export async function setupAction({ request, response }: RequestInfo) {
  if ((await userCount()) > 0) return redirect("/login");
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const kept = { name: field(form, "name"), email: field(form, "email") };
  if (!env.SETUP_TOKEN || token !== env.SETUP_TOKEN) {
    response.status = 403;
    return <SetupView hasToken {...kept} err={t({ id: "setup.token_wrong", message: "Invalid setup token." })} bad="token" />;
  }
  const password = String(form.get("password") ?? "");
  if (password.length < 10) {
    response.status = 400;
    return <SetupView hasToken {...kept} err={t({ id: "setup.password_short", message: "Password too short: use 10 characters or more." })} bad="password" />;
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
