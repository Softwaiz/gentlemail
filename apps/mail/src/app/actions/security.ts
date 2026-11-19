"use server";

import { env } from "cloudflare:workers";
import { requestInfo, serverAction } from "rwsdk/worker";
import { type ActionResult, adminOnly, fail, ok, signedIn, signedInForMfaSetup, text } from "@/app/actions/guards";
import { appName } from "@/app/components/brand";
import { formatSecret, newTotpSecret, otpauthUri, qrDataUrl, replaceRecoveryCodes, verifySecondFactor } from "@/lib/mfa";
import { now } from "@/lib/util";
import { endConnections } from "@/lib/apikeys";

/*
 * Two-step verification: each person's own setup (Security page), and the
 * admin's switch and reset. Codes are always checked on the server.
 */

const me = () => requestInfo.ctx.user!;

const clearMfa = (userId: string) => [
  env.DB.prepare("UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL WHERE id = ?").bind(userId),
  env.DB.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").bind(userId),
];

/** Step 1: a new secret, shown as a QR code and as text. Not active until a code from it is confirmed. */
export const startMfaSetupAction = serverAction([
  signedInForMfaSetup,
  async (): Promise<ActionResult<{ secret: string; qr: string; uri: string }>> => {
    const user = me();
    if (user.mfa) return fail("Two-step verification is already on.");
    const secret = newTotpSecret();
    await env.DB.prepare("UPDATE users SET mfa_secret = ?, mfa_last_step = NULL WHERE id = ? AND mfa_enabled_at IS NULL")
      .bind(secret, user.id)
      .run();
    const issuer = `${appName()} (${new URL(requestInfo.request.url).hostname})`;
    const uri = otpauthUri(secret, user.email, issuer);
    return ok(undefined, { data: { secret: formatSecret(secret), qr: qrDataUrl(uri), uri } });
  },
]);

/** Step 2: the first code proves the app is set up; two-step turns on and the recovery codes are shown once. */
export const confirmMfaSetupAction = serverAction([
  signedInForMfaSetup,
  async (form: FormData): Promise<ActionResult<{ codes: string[] }>> => {
    const user = me();
    if (user.mfa) return fail("Two-step verification is already on.");
    const check = await verifySecondFactor(user.id, text(form, "code"), { pendingSetup: true });
    if (!check.ok) return fail("That code didn't match. Check the time on your phone is set automatically, then try the newest code.");
    await env.DB.prepare("UPDATE users SET mfa_enabled_at = ? WHERE id = ? AND mfa_secret IS NOT NULL").bind(now(), user.id).run();
    const codes = await replaceRecoveryCodes(user.id);
    // The page re-renders after this; the panel keeps showing the codes (its state survives) until they're saved.
    return ok(undefined, { data: { codes } });
  },
]);

export const regenerateRecoveryCodesAction = serverAction([
  signedIn,
  async (form: FormData): Promise<ActionResult<{ codes: string[] }>> => {
    const user = me();
    if (!user.mfa) return fail("Turn on two-step verification first.");
    const check = await verifySecondFactor(user.id, text(form, "code"));
    if (!check.ok) return fail("That code didn't match. Use the newest code from your app.");
    return ok(undefined, { data: { codes: await replaceRecoveryCodes(user.id) } });
  },
]);

export const disableMfaAction = serverAction([
  signedIn,
  async (form: FormData): Promise<ActionResult> => {
    const user = me();
    if (!user.mfa) return ok();
    const check = await verifySecondFactor(user.id, text(form, "code"), { allowRecovery: true });
    if (!check.ok) return fail("That code didn't match. Use the newest code from your app, or a recovery code.");
    await env.DB.batch(clearMfa(user.id));
    return ok("Two-step verification is off.");
  },
]);

/* ---------- Admin ---------- */

export const setRequireMfaAction = serverAction([
  adminOnly,
  async (_id: string, on: boolean): Promise<ActionResult> => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('require_mfa', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(on ? "1" : "0")
      .run();
    return ok(
      on
        ? me().mfa
          ? "Two-step verification is now required. People without it set it up the next time they open a page."
          : "Two-step verification is now required, starting with you."
        : "Two-step verification is now optional.",
      on && !me().mfa ? { redirect: "/account/security" } : undefined,
    );
  },
]);

/** For someone who lost their phone and their recovery codes: turns two-step off and signs them out everywhere. */
export const resetUserMfaAction = serverAction([
  adminOnly,
  async (userId: string): Promise<ActionResult> => {
    if (userId === me().id) return fail("Use your own Security page to change your two-step verification.");
    const user = await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(userId).first<{ name: string }>();
    if (!user) return fail("This user no longer exists.");
    await env.DB.batch([...clearMfa(userId), env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId), ...endConnections(userId)]);
    return ok(`Two-step verification reset for ${user.name}. They sign in with their password and set it up again; their assistants are disconnected.`);
  },
]);
