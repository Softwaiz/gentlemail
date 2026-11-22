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
import { field, redirect, safeNext, withFlash } from "@/app/http";
import { LoginView, SetupView, VerifyView } from "@/app/pages/auth-views";

export { AuthCard } from "@/app/pages/auth-views";

const userCount = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>())?.n ?? 0;

/* ---------- Login ---------- */

export async function LoginPage({ request, ctx }: RequestInfo) {
  if (ctx.user) return redirect("/");
  if ((await userCount()) === 0) return redirect("/setup");
  const u = new URL(request.url);
  return <LoginView next={u.searchParams.get("next") ?? "/"} err={u.searchParams.get("err")} />;
}

export async function loginAction({ request }: RequestInfo) {
  const form = await request.formData();
  const email = field(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(field(form, "next"));
  const row = await env.DB.prepare("SELECT id, password_hash, mfa_enabled_at FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; password_hash: string; mfa_enabled_at: number | null }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return redirect(withFlash(`/login?next=${encodeURIComponent(next)}`, "err", "Wrong email or password."));
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
  if (!challenge) return redirect(withFlash("/login", "err", "Your sign-in timed out. Enter your password again."));
  return <VerifyView email={challenge.email} err={new URL(request.url).searchParams.get("err")} />;
}

export async function loginVerifyAction({ request }: RequestInfo) {
  const challenge = await getLoginChallenge(request);
  if (!challenge) return redirect(withFlash("/login", "err", "Your sign-in timed out. Enter your password again."));
  const code = String((await request.formData()).get("code") ?? "");
  const result = await verifySecondFactor(challenge.user_id, code, { allowRecovery: true });

  if (!result.ok) {
    const attempts = challenge.attempts + 1;
    if (attempts >= CHALLENGE_MAX_ATTEMPTS) {
      const cookie = await endLoginChallenge(challenge.id, request);
      return redirect(withFlash("/login", "err", "Too many wrong codes. Enter your password again."), { "Set-Cookie": cookie });
    }
    await env.DB.prepare("UPDATE login_challenges SET attempts = ? WHERE id = ?").bind(attempts, challenge.id).run();
    const left = CHALLENGE_MAX_ATTEMPTS - attempts;
    return redirect(withFlash("/login/verify", "err", `That code didn't work. ${left} ${left === 1 ? "try" : "tries"} left.`));
  }

  const headers = new Headers();
  headers.append("Set-Cookie", await endLoginChallenge(challenge.id, request));
  headers.append("Set-Cookie", await createSession(challenge.user_id, request));
  let next = safeNext(challenge.next);
  if (result.usedRecovery) {
    const left = await recoveryCodesLeft(challenge.user_id);
    // Security says how many codes are left, then offers to continue to `next` (an assistant's sign-in, say).
    const security = next === "/" ? "/account/security" : `/account/security?next=${encodeURIComponent(next)}`;
    next = withFlash(security, left ? "msg" : "err", left
      ? `Signed in with a recovery code. ${left} left.`
      : "That was your last recovery code. Make new ones now.");
  }
  return redirect(next, headers);
}

export async function logoutAction({ request }: RequestInfo) {
  const cookie = await destroySession(request);
  return redirect("/login", { "Set-Cookie": cookie });
}

/* ---------- First-run setup ---------- */

export async function SetupPage({ request }: RequestInfo) {
  if ((await userCount()) > 0) return redirect("/login");
  return <SetupView hasToken={!!env.SETUP_TOKEN} err={new URL(request.url).searchParams.get("err")} />;
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
