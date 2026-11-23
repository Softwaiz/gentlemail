"use server";

import { env } from "cloudflare:workers";
import { requestInfo, serverAction } from "rwsdk/worker";
import { type ActionResult, fail, ok, signedInForMfaSetup } from "@/app/actions/guards";
import { isLocale, localeCookie } from "@/lib/i18n";
import { t } from "@lingui/core/macro";

/**
 * Saves the language picked in the user menu on the account, so every device follows it, and
 * in this device's cookie; null goes back to the browser's language.
 */
export const setLanguageAction = serverAction([
  // Allowed before two-step is set up too: the setup page itself should be in your language.
  signedInForMfaSetup,
  async (language: string | null): Promise<ActionResult> => {
    if (language !== null && !isLocale(language)) return fail(t({ id: "errors.unknown_language", message: "Unknown language." }));
    await env.DB.prepare("UPDATE users SET language = ? WHERE id = ?").bind(language, requestInfo.ctx.user!.id).run();
    requestInfo.response.headers.append("Set-Cookie", localeCookie(language, requestInfo.request));
    return ok();
  },
]);
